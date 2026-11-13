import { eq } from "drizzle-orm";
import { raceMapProjectLinkStateSchema, type RaceMapProblem, type RaceMapProjectLinkState } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { applyMapColors, applyMapRevision } from "@o-tid/map-file";
import { toChangeSet, type ObjectChange } from "@o-tid/map-revision";
import { type ClubFailure, type ClubProof } from "./club-access";
import { agreementOf } from "./club-maps";
import { courseSettingRead, loadMapFile, type ReadProof } from "./course-setting";
import type { MapContentInput, MapQuotaExceeded } from "./map-content";
import { mapProjectRoleOf, requireMapProject, type MapProjectRow } from "./map-project-access";
import { baseFile, ocadWriteEnabled, readBase, savedChanges, type BaseFile } from "./map-project-output";
import { mapFileFormatOf, saveRaceMapSourceAsAdmin } from "./race-map-source";
import { sha256Hex, UUID_PATTERN } from "./serialization";
import type { DbExecutor } from "./snapshot";

/**
 * Ägarens plan 2026-11-13, etapp 1: banläggningens karta ur ett kartprojekt i stället för en uppladdad fil.
 *
 * Kartan är en **ögonblicksbild**: grundfilen med projektets införda ändringar och ändrade färger, skriven med samma
 * skrivare som "Skapa ny kartversion" (`applyMapRevision`, som läser filen igen och vägrar om något inte stämmer). Bilden
 * sparas som tävlingens kartfil på samma väg som en uppladdad fil (`saveRaceMapSourceAsAdmin`: samma kontroller, samma
 * lagring och cache), och `race_map_project_link` säger vilket projekt och vilket löpnummer den motsvarar. Kartan under
 * banorna ändras alltså inte när projektet ändras; «Ta in kartans ändringar» är samma anrop en gång till.
 *
 * Webbläsaren ritar kartbilden som för alla kartfiler: den hämtar bilden av projektet (`readMapProjectCurrentFile`), ritar
 * den och skickar bilden och det den räknat fram tillsammans med filens sha256. Servern skriver filen igen ur det som är
 * sparat och sparar bara om den blir samma fil; har någon hunnit ändra kartan är svaret "conflict" och webbläsaren hämtar på nytt.
 *
 * Behörighet: minst Läsa i projektet (den som inte är med får "not-found") och administratör i tävlingen (kartfilens regel).
 * Ingen ny version skapas i projektet och inget läggs i klubbarkivet.
 */
type Refusal = { code: string; message: string };
export type MapProjectSnapshot = { status: "ok"; bytes: Uint8Array; sha256: string } | { status: "refused"; refusals: Refusal[] };
interface SnapshotInputs { project: MapProjectRow; base: BaseFile; changes: ObjectChange[] }

async function snapshotInputs(tx: DbExecutor, project: MapProjectRow): Promise<SnapshotInputs | undefined> {
  const base = await baseFile(tx, project);
  return base ? { project, base, changes: (await savedChanges(tx, project)).changes } : undefined;
}

/** Projektets aktuella karta som fil. Utan ändringar är det grundfilen orörd. Samma sparade läge ger alltid samma fil. */
export function composeMapProjectSnapshot({ project, base, changes }: SnapshotInputs): MapProjectSnapshot {
  const refused = (code: string, message: string): MapProjectSnapshot => ({ status: "refused", refusals: [{ code, message }] });
  if (changes.length === 0 && !project.colors?.length) return { status: "ok", bytes: base.bytes, sha256: sha256Hex(base.bytes) };
  const map = readBase(base.bytes, base.fileName);
  if (!map) return refused("UNSAFE_FILE", "Grundfilen går inte att läsa.");
  const written = applyMapRevision(base.bytes, toChangeSet(map, project.baseSha256, project.baseFormat, changes), { ocad: ocadWriteEnabled() });
  if (!written.ok) {
    return { status: "refused", refusals: written.refusals.slice(0, 50).map(refusal => ({ code: refusal.code, message: refusal.message })) };
  }
  const colored = applyMapColors(written.bytes, project.colors ?? []);
  if (!colored.ok) return refused("VERIFY_FAILED", colored.message);
  if (colored.bytes.byteLength === 0 || mapFileFormatOf(colored.bytes.subarray(0, 4096)) !== project.baseFormat) {
    return refused("VERIFY_FAILED", "Den skrivna filen är inte en kartfil i samma format som grundfilen.");
  }
  return { status: "ok", bytes: colored.bytes, sha256: sha256Hex(colored.bytes) };
}

export type MapProjectCurrentFile = ClubFailure | { status: "refused"; refusals: Refusal[] }
  | { status: "ok"; fileName: string; format: "OCD" | "OMAP"; seq: number; sha256: string; bytes: Uint8Array };

/** Projektets aktuella karta (grundfilen med införda ändringar) för alla som får läsa projektet. Ändrar ingenting. */
export async function readMapProjectCurrentFile(db: Database, input: ClubProof & { projectId: string }, now = new Date())
  : Promise<MapProjectCurrentFile> {
  const loaded = await db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    const inputs = await snapshotInputs(tx, access.project);
    return inputs ? { status: "ready", inputs } as const : { status: "not-found" } as const;
  });
  if (loaded.status !== "ready") return loaded;
  const snapshot = composeMapProjectSnapshot(loaded.inputs);
  if (snapshot.status !== "ok") return snapshot;
  const { project, base } = loaded.inputs;
  return { status: "ok", fileName: base.fileName, format: project.baseFormat, seq: project.seq, sha256: snapshot.sha256, bytes: snapshot.bytes };
}

export type MapProjectToRaceResult = ClubFailure | { status: "refused"; refusals: Refusal[] }
  | { status: "problem"; problem: RaceMapProblem; quota?: MapQuotaExceeded } | { status: "ok"; georeferenced: boolean; seq: number };

/**
 * Kopplar tävlingens karta till projektet, eller tar in projektets ändringar (samma sak: en ny ögonblicksbild ersätter
 * kartfilen). `sha256` är filen som webbläsaren ritade bilden ur; stämmer den inte med projektets aktuella karta sparas inget.
 * Kommer projektet ur klubbarkivet följer kartans rättigheter med till tävlingen, som när kartan väljs ur arkivet.
 */
export async function saveMapProjectSnapshotToRace(db: Database, input: ClubProof & { projectId: string; raceId: string; sha256: string;
  image: MapContentInput; metadata: unknown }, now = new Date()): Promise<MapProjectToRaceResult> {
  const loaded = await db.transaction(async tx => {
    // Projektet först: utloggad och den som inte är med får samma svar oavsett vad som skickats.
    const access = await requireMapProject(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    if (!UUID_PATTERN.test(input.raceId) || !/^[a-f0-9]{64}$/.test(input.sha256)) return { status: "invalid-request" } as const;
    const inputs = await snapshotInputs(tx, access.project);
    if (!inputs) return { status: "not-found" } as const;
    const [archived] = access.project.baseVersionId ? await tx.select({ map: schema.clubMaps }).from(schema.clubMapVersions)
      .innerJoin(schema.clubMaps, eq(schema.clubMaps.id, schema.clubMapVersions.mapId))
      .where(eq(schema.clubMapVersions.id, access.project.baseVersionId)) : [];
    return { status: "ready", inputs, accountId: access.accountId, clubMap: archived?.map } as const;
  });
  if (loaded.status !== "ready") return loaded;
  const snapshot = composeMapProjectSnapshot(loaded.inputs);
  if (snapshot.status !== "ok") return snapshot;
  if (snapshot.sha256 !== input.sha256) return { status: "conflict" };
  const { project, base } = loaded.inputs;
  const { raceId } = input;
  const link = { projectId: project.id, seq: project.seq, sha256: snapshot.sha256, colorsChangedAt: project.colorsChangedAt, linkedBy: loaded.accountId,
    linkedAt: now };
  const saved = await saveRaceMapSourceAsAdmin(db, { raceId, sessionToken: input.sessionToken, csrfCookie: input.csrfCookie ?? null,
    csrfHeader: input.csrfHeader ?? null, file: snapshot.bytes, fileName: base.fileName, image: input.image, metadata: input.metadata,
    alsoSave: async tx => {
      await tx.insert(schema.raceMapProjectLinks).values({ raceId, ...link }).onConflictDoUpdate({ target: schema.raceMapProjectLinks.raceId, set: link });
      if (loaded.clubMap) {
        const values = { sourceMapId: null, mapName: loaded.clubMap.name, ...agreementOf(loaded.clubMap), updatedAt: now };
        await tx.insert(schema.raceMapAgreements).values({ raceId, ...values })
          .onConflictDoUpdate({ target: schema.raceMapAgreements.raceId, set: { ...values, publicUseAcknowledgedAt: null, publicUseAcknowledgedBy: null } });
      }
      await tx.insert(schema.auditEvents).values({ raceId, entityType: "race_map", entityId: raceId, action: "RACE_MAP_PROJECT_LINKED",
        actorKind: "USER_ACCOUNT", actorId: loaded.accountId, after: { projectId: project.id, seq: project.seq, sha256: snapshot.sha256 } });
    } }, now);
  return saved.status === "ok" ? { status: "ok", georeferenced: saved.georeferenced, seq: project.seq } : saved;
}

type ReadFailure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "too-large" };

/**
 * Vilket kartprojekt banläggningens karta kommer ur, vilket löpnummer den är låst vid och hur många ändringar projektet har
 * fått sedan dess (en färgändring räknas som en). För alla som får läsa banläggningen; projektets namn och antalet är inte
 * hemliga för dem, men bara den som är med i projektet kan öppna det. Utan koppling (eller när kartfilen har bytts) null.
 */
export async function readRaceMapProjectLink(db: Database, input: ReadProof, now = new Date())
  : Promise<ReadFailure | { status: "ok"; response: RaceMapProjectLinkState }> {
  return courseSettingRead(db, input, now, async (tx, raceId, principal) => {
    const none = { status: "ok" as const, response: raceMapProjectLinkStateSchema.parse({ formatVersion: 1, link: null }) };
    const [link] = await tx.select().from(schema.raceMapProjectLinks).where(eq(schema.raceMapProjectLinks.raceId, raceId));
    if (!link || (await loadMapFile(tx, raceId))?.sha256 !== link.sha256) return none;
    const [project] = await tx.select().from(schema.mapProjects).where(eq(schema.mapProjects.id, link.projectId));
    if (!project) return none;
    const member = await mapProjectRoleOf(tx, principal.accountId, project) !== undefined;
    const recolored = (project.colorsChangedAt?.getTime() ?? 0) !== (link.colorsChangedAt?.getTime() ?? 0);
    return { status: "ok" as const, response: raceMapProjectLinkStateSchema.parse({ formatVersion: 1, link: { projectId: project.id,
      projectName: project.name.slice(0, 200), seq: link.seq, linkedAt: link.linkedAt.toISOString(),
      newerChanges: Math.max(0, project.seq - link.seq) + (recolored ? 1 : 0), member, canUpdate: member && principal.admin } }) };
  });
}
