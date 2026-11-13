import { randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { CLUB_ARCHIVE_MAP_MAX_BYTES, mapProjectOutputRequestSchema, type MapProjectOutputResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { applyMapColors, applyMapRevision, MapFileError, readMapFile, type ParsedMap } from "@o-tid/map-file";
import {
  changeCounts, changeList, changesGeoJson, mapperChangesFile, parseObjectRef, toChangeSet, validState, type KeyedState, type ObjectChange,
  type ObjectKey
} from "@o-tid/map-revision";
import { type ClubFailure, type ClubProof } from "./club-access";
import { mapStorageQuota, readMapContent, storeMapContent } from "./map-content";
import { mapProjectBaseFileName, mapProjectCanArchive, mapProjectJournal, requireMapProject, type MapProjectRow } from "./map-project-access";
import { mapFileFormatOf } from "./race-map-source";
import type { DbExecutor } from "./snapshot";
import { swedishToday } from "@o-tid/domain";

/**
 * ADR-0219 beslut 5–6: "Skapa ny kartversion" och "Exportera ändringarna". Servern bygger ändringarna ur det som är sparat
 * (inte ur det klienten skickar) och ger dem till skrivaren (`applyMapRevision`), som lappar grundfilen, läser den igen och
 * vägrar om något inte stämmer. Resultatet sparas alltid i projektet (`map_project_output` med eget innehåll), och när
 * projektet hör till en klubb kan en administratör där också lägga det som en **ny** version av samma karta i klubbarkivet med
 * anteckningen "Reviderad av …, n ändringar". Grundfilen ändras aldrig och projektet fortsätter (en senare version innehåller
 * alla ändringar fram till dess).
 *
 * Skrivaren körs utanför transaktionen. Har någon ändrat under tiden (projektets löpnummer har ändrats) sparas inget och
 * svaret säger det. Vägrar skrivaren sparas inget och skälen visas som de är; exporten finns kvar.
 */
const NOTE_MAX = 500;

/** "Anna", "Anna och Bo", "Anna, Bo och Cia" (kortas med "m.fl." när anteckningen blir för lång). */
export function revisionNote(names: readonly string[], changes: number): string {
  const tail = `, ${changes} ${changes === 1 ? "ändring" : "ändringar"}`;
  const list = (rows: readonly string[], more: boolean) => more ? `${rows.join(", ")} m.fl.`
    : rows.length <= 1 ? rows.join("") : `${rows.slice(0, -1).join(", ")} och ${rows[rows.length - 1]}`;
  for (let take = names.length; take >= 1; take -= 1) {
    const note = `Reviderad av ${list(names.slice(0, take), take < names.length)}${tail}`;
    if (note.length <= NOTE_MAX) return note;
  }
  return `Reviderad${tail}`;
}

/** "Skogen V11.omap" → "Skogen V11 reviderad 2026-11-07.omap". */
export function revisedFileName(fileName: string, date: string, format: "OCD" | "OMAP"): string {
  const match = /^(.*?)(\.[A-Za-z0-9]{2,5})?$/.exec(fileName.trim());
  const stem = (match?.[1] || "karta").slice(0, 160);
  const extension = match?.[2] ?? (format === "OCD" ? ".ocd" : ".omap");
  return `${stem} reviderad ${date}${extension}`;
}

/** Projektets ändringar ur databasen, i nyckelordning (samma lägen ger alltid samma lista). */
export async function savedChanges(tx: DbExecutor, project: MapProjectRow): Promise<{ changes: ObjectChange[]; authors: string[] }> {
  const rows = await tx.select().from(schema.mapProjectObjects).where(eq(schema.mapProjectObjects.projectId, project.id));
  const states: [ObjectKey, KeyedState][] = rows.flatMap(row => {
    const ref = row.ref === null ? null : parseObjectRef(row.ref);
    if (!validState(row.state) || (row.ref !== null && !ref)) return [];
    return [[row.objectKey, { ref: ref ?? null, state: row.state, author: row.authorAccountId, at: row.editedAt.toISOString() }]];
  });
  const changes = changeList(states);
  return { changes, authors: [...new Set(changes.map(change => change.author))] };
}

export interface BaseFile { fileName: string; mapId: string | null; bytes: Uint8Array }

export async function baseFile(tx: DbExecutor, project: MapProjectRow): Promise<BaseFile | undefined> {
  const [version] = project.baseVersionId ? await tx.select({ mapId: schema.clubMapVersions.mapId }).from(schema.clubMapVersions)
    .where(eq(schema.clubMapVersions.id, project.baseVersionId)) : [];
  const fileName = await mapProjectBaseFileName(tx, project);
  const bytes = await readMapContent(tx, project.baseSha256);
  if (!fileName || !bytes || (project.baseVersionId && !version)) return undefined;
  return { fileName, mapId: version?.mapId ?? null, bytes: new Uint8Array(bytes) };
}

export function readBase(bytes: Uint8Array, fileName: string): ParsedMap | undefined {
  try { return readMapFile(bytes, fileName, { sources: true }); }
  catch (error) {
    if (error instanceof MapFileError) return undefined;
    throw error;
  }
}

type OutputResult = ClubFailure | { status: "ok"; replayed: boolean; response: MapProjectOutputResponse };
type Prepared = { status: "replayed"; response: MapProjectOutputResponse }
  | { status: "ready"; project: MapProjectRow; base: BaseFile; bytes: Uint8Array; changes: ObjectChange[]; names: string[] };

async function outputResponse(tx: DbExecutor, output: typeof schema.mapProjectOutputs.$inferSelect): Promise<MapProjectOutputResponse> {
  const [version] = output.versionId ? await tx.select({ fileName: schema.clubMapVersions.fileName }).from(schema.clubMapVersions)
    .where(eq(schema.clubMapVersions.id, output.versionId)) : [];
  return { formatVersion: 1, status: "created", outputId: output.id, versionId: output.versionId, fileName: output.fileName ?? version?.fileName ?? "",
    changes: output.changes, added: 0, modified: 0, deleted: 0 };
}

async function prepare(tx: DbExecutor, access: { accountId: string; project: MapProjectRow }, requestId: string, archive: boolean)
  : Promise<ClubFailure | Prepared | { status: "ok"; replayed: boolean; response: MapProjectOutputResponse }> {
  const { project } = access;
  if (archive && !await mapProjectCanArchive(tx, access.accountId, project)) return { status: "forbidden" };
  const outputs = schema.mapProjectOutputs;
  const [prior] = await tx.select().from(outputs).where(eq(outputs.requestId, requestId));
  if (prior) return prior.projectId === project.id ? { status: "replayed", response: await outputResponse(tx, prior) } : { status: "conflict" };
  // Inget har ändrats sedan förra versionen: samma version igen i stället för en dubblett (om den inte ska läggas i arkivet nu).
  const [latest] = await tx.select().from(outputs).where(eq(outputs.projectId, project.id)).orderBy(desc(outputs.createdAt)).limit(1);
  const recolored = !!project.colorsChangedAt && (!latest || project.colorsChangedAt > latest.createdAt);
  if (latest && latest.seq === project.seq && !recolored && (!archive || latest.versionId)) {
    return { status: "ok", replayed: true, response: await outputResponse(tx, latest) };
  }
  const { changes, authors } = await savedChanges(tx, project);
  // Bara ändrade färger räcker för en ny version.
  if (changes.length === 0 && !project.colors?.length) return { status: "ok", replayed: false, response: { formatVersion: 1, status: "empty" } };
  const file = await baseFile(tx, project);
  if (!file) return { status: "not-found" };
  const names = authors.length ? (await tx.select({ name: schema.userAccounts.displayName }).from(schema.userAccounts)
    .where(inArray(schema.userAccounts.id, authors))).map(row => row.name).sort((a, b) => a.localeCompare(b, "sv")) : [];
  return { status: "ready", project, base: file, bytes: file.bytes, changes, names };
}

/**
 * ADR-0219 K7: OCAD-kartor (version 9+) skrivs bara med `OTID_OCAD_WRITE=1`, tills skrivningen är prövad i riktiga OCAD.
 * Utan flaggan vägras en ny version av en OCAD-karta med ett besked (ändringarna kan exporteras).
 */
export function ocadWriteEnabled(env: Partial<Record<string, string | undefined>> = process.env): boolean {
  return env.OTID_OCAD_WRITE?.trim() === "1";
}

export async function writeMapProjectVersion(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date())
  : Promise<OutputResult> {
  const parsed = mapProjectOutputRequestSchema.safeParse(input.request);
  const prepared = await db.transaction(async tx => {
    // Behörigheten först: den som inte får skriva får samma svar oavsett kroppen.
    const access = await requireMapProject(tx, input, now, "manage", false);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    return prepare(tx, access, parsed.data.requestId, parsed.data.archive === true);
  });
  if (prepared.status === "replayed") return { status: "ok", replayed: true, response: prepared.response };
  if (prepared.status !== "ready") return prepared;

  const { project, base, bytes, changes, names } = prepared;
  const archive = parsed.success && parsed.data.archive === true;
  const refused = (code: string, message: string): OutputResult => ({ status: "ok", replayed: false,
    response: { formatVersion: 1, status: "refused", refusals: [{ code, message }] } });
  const map = readBase(bytes, base.fileName);
  if (!map) return refused("UNSAFE_FILE", "Grundfilen går inte att läsa.");
  const written = applyMapRevision(bytes, toChangeSet(map, project.baseSha256, project.baseFormat, changes), { ocad: ocadWriteEnabled() });
  if (!written.ok) {
    return { status: "ok", replayed: false, response: { formatVersion: 1, status: "refused",
      refusals: written.refusals.slice(0, 50).map(refusal => ({ code: refusal.code, message: refusal.message })) } };
  }
  // Färgtabellens ändringar (ägaren 2026-11-10) skrivs som ett eget kontrollerat steg efter objekten.
  const colored = applyMapColors(written.bytes, project.colors ?? []);
  if (!colored.ok) return refused("VERIFY_FAILED", colored.message);
  const outputBytes = colored.bytes;
  if (outputBytes.byteLength === 0 || outputBytes.byteLength > CLUB_ARCHIVE_MAP_MAX_BYTES ||
    mapFileFormatOf(outputBytes.subarray(0, 4096)) !== project.baseFormat) {
    return refused("VERIFY_FAILED", "Den skrivna filen är inte en kartfil i samma format som grundfilen.");
  }
  const counts = changeCounts(changes);
  const report = written.report;
  const note = revisionNote(names, counts.total);
  const date = swedishToday(now);
  const fileName = revisedFileName(base.fileName, date, project.baseFormat).slice(0, 200);
  return db.transaction(async (tx): Promise<OutputResult> => {
    const access = await requireMapProject(tx, input, now, "manage", true);
    if (access.status !== "ok") return access;
    if (archive && !await mapProjectCanArchive(tx, access.accountId, access.project)) return { status: "forbidden" };
    // Någon hann ändra medan filen skrevs: inget sparas (försök igen så kommer ändringen med).
    if (access.project.seq !== project.seq) return { status: "conflict" };
    const stored = await storeMapContent(tx, outputBytes, access.accountId, now, mapStorageQuota());
    if (stored.status === "quota") return refused("QUOTA", "Kvoten för kartfiler är full.");
    const versionId = archive && project.clubId && base.mapId ? randomUUID() : null;
    if (versionId && project.clubId && base.mapId) {
      await tx.insert(schema.clubMapVersions).values({ id: versionId, clubId: project.clubId, mapId: base.mapId, contentSha256: stored.sha256, fileName,
        format: project.baseFormat, byteLength: outputBytes.byteLength, versionDate: date, note, uploadedBy: access.accountId, uploadedAt: now,
        sourcePath: null });
    }
    const outputId = randomUUID();
    await tx.insert(schema.mapProjectOutputs).values({ id: outputId, projectId: project.id, versionId, contentSha256: stored.sha256, fileName,
      seq: project.seq, changes: counts.total, createdBy: access.accountId, createdAt: now,
      requestId: parsed.success ? parsed.data.requestId : randomUUID() });
    await mapProjectJournal(tx, project, { action: "MAP_PROJECT_VERSION_CREATED", actorAccountId: access.accountId,
      details: { projectId: project.id, baseVersionId: project.baseVersionId, outputId, versionId, changes: counts.total, edits: report.edits.length,
        identicalBytes: report.verification.identicalBytes, colors: colored.changed }, now });
    return { status: "ok", replayed: false, response: { formatVersion: 1, status: "created", outputId, versionId, fileName, changes: counts.total,
      added: report.added, modified: report.modified, deleted: report.deleted } };
  });
}

export type MapProjectExportFormat = "omap" | "geojson";

/**
 * Ändringarna som en liten egen fil: Mapper-fil med bara ändrade och nya objekt (när grundfilen är en Mapper-fil) eller
 * GeoJSON. Alla medlemmar får exportera. Inga namn på dem som ändrade.
 */
export async function exportMapProjectChanges(db: Database, input: ClubProof & { projectId: string; format: MapProjectExportFormat }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; fileName: string; contentType: string; body: string }> {
  const loaded = await db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    if (input.format === "omap" && access.project.baseFormat !== "OMAP") return { status: "invalid-request" } as const;
    const file = await baseFile(tx, access.project);
    if (!file) return { status: "not-found" } as const;
    return { status: "ready", project: access.project, fileName: file.fileName, bytes: file.bytes,
      changes: (await savedChanges(tx, access.project)).changes } as const;
  });
  if (loaded.status !== "ready") return loaded;
  const map = readBase(loaded.bytes, loaded.fileName);
  if (!map) return { status: "not-found" };
  const stem = loaded.fileName.replace(/\.[A-Za-z0-9]{2,5}$/, "").slice(0, 120) || "karta";
  if (input.format === "geojson") {
    return { status: "ok", fileName: `${stem} ändringar.geojson`, contentType: "application/geo+json",
      body: JSON.stringify(changesGeoJson(map, loaded.changes, stem)) };
  }
  const text = new TextDecoder("utf-8").decode(loaded.bytes).replace(/^\uFEFF/, "");
  const body = mapperChangesFile(text, map, loaded.changes);
  return body === undefined ? { status: "not-found" }
    : { status: "ok", fileName: `${stem} ändringar.xmap`, contentType: "application/xml", body };
}


/** Ett resultat i projektet (alla medlemmar): innehållets id för strömmen och filnamnet. */
export async function readMapProjectOutput(db: Database, input: ClubProof & { projectId: string; outputId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; fileName: string; byteLength: number; contentId: string; sha256: string }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    const outputs = schema.mapProjectOutputs;
    const [output] = await tx.select().from(outputs).where(eq(outputs.id, input.outputId));
    if (!output || output.projectId !== access.project.id) return { status: "not-found" } as const;
    const [version] = output.versionId ? await tx.select({ sha256: schema.clubMapVersions.contentSha256, fileName: schema.clubMapVersions.fileName })
      .from(schema.clubMapVersions).where(eq(schema.clubMapVersions.id, output.versionId)) : [];
    const sha256 = output.contentSha256 ?? version?.sha256;
    const fileName = output.fileName ?? version?.fileName;
    if (!sha256 || !fileName) return { status: "not-found" } as const;
    const [content] = await tx.select({ byteLength: schema.mapContents.byteLength, contentId: schema.mapContents.contentId })
      .from(schema.mapContents).where(eq(schema.mapContents.sha256, sha256));
    return content ? { status: "ok", fileName, sha256, ...content } as const : { status: "not-found" } as const;
  });
}
