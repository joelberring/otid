import { randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { CLUB_ARCHIVE_MAP_MAX_BYTES, mapProjectOutputRequestSchema, type MapProjectOutputResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { applyMapRevision, MapFileError, readMapFile, type ParsedMap } from "@o-tid/map-file";
import {
  changeCounts, changeList, changesGeoJson, mapperChangesFile, parseObjectRef, toChangeSet, validState, type KeyedState, type ObjectChange,
  type ObjectKey
} from "@o-tid/map-revision";
import { clubJournal, clubMembership, clubRoleAtLeast, type ClubFailure, type ClubProof } from "./club-access";
import { mapStorageQuota, readMapContent, storeMapContent } from "./map-content";
import { requireMapProject, type MapProjectRow } from "./map-project-access";
import { mapFileFormatOf } from "./race-map-source";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0219 beslut 5–6: "Skapa ny kartversion" och "Exportera ändringarna". Servern bygger ändringarna ur det som är sparat
 * (inte ur det klienten skickar) och ger dem till skrivaren (`applyMapRevision`), som lappar grundfilen, läser den igen och
 * vägrar om något inte stämmer. Resultatet blir en **ny** version av samma karta i klubbarkivet med anteckningen
 * "Reviderad av …, n ändringar". Grundversionen ändras aldrig och projektet fortsätter (en senare version innehåller alla
 * ändringar fram till dess).
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
async function savedChanges(tx: DbExecutor, project: MapProjectRow): Promise<{ changes: ObjectChange[]; authors: string[] }> {
  const rows = await tx.select().from(schema.mapProjectObjects).where(eq(schema.mapProjectObjects.projectId, project.id));
  const states: [ObjectKey, KeyedState][] = rows.flatMap(row => {
    const ref = row.ref === null ? null : parseObjectRef(row.ref);
    if (!validState(row.state) || (row.ref !== null && !ref)) return [];
    return [[row.objectKey, { ref: ref ?? null, state: row.state, author: row.authorAccountId, at: row.editedAt.toISOString() }]];
  });
  const changes = changeList(states);
  return { changes, authors: [...new Set(changes.map(change => change.author))] };
}

async function canWriteVersion(tx: DbExecutor, accountId: string, project: MapProjectRow): Promise<boolean> {
  const club = await clubMembership(tx, { accountId, clubId: project.clubId }, "none");
  return !!club && clubRoleAtLeast(club.role, "ADMIN");
}

async function baseFile(tx: DbExecutor, project: MapProjectRow) {
  const [base] = await tx.select().from(schema.clubMapVersions).where(eq(schema.clubMapVersions.id, project.baseVersionId));
  const bytes = await readMapContent(tx, project.baseSha256);
  return base && bytes ? { base, bytes: new Uint8Array(bytes) } : undefined;
}

function readBase(bytes: Uint8Array, fileName: string): ParsedMap | undefined {
  try { return readMapFile(bytes, fileName, { sources: true }); }
  catch (error) {
    if (error instanceof MapFileError) return undefined;
    throw error;
  }
}

type OutputResult = ClubFailure | { status: "ok"; replayed: boolean; response: MapProjectOutputResponse };
type Prepared = { status: "replayed"; response: MapProjectOutputResponse }
  | { status: "ready"; project: MapProjectRow; base: typeof schema.clubMapVersions.$inferSelect; bytes: Uint8Array; changes: ObjectChange[];
    names: string[] };

async function outputResponse(tx: DbExecutor, versionId: string, changes: number): Promise<MapProjectOutputResponse> {
  const [version] = await tx.select({ fileName: schema.clubMapVersions.fileName }).from(schema.clubMapVersions).where(eq(schema.clubMapVersions.id, versionId));
  return { formatVersion: 1, status: "created", versionId, fileName: version?.fileName ?? "", changes, added: 0, modified: 0, deleted: 0 };
}

async function prepare(tx: DbExecutor, access: { accountId: string; project: MapProjectRow }, requestId: string)
  : Promise<ClubFailure | Prepared | { status: "ok"; replayed: boolean; response: MapProjectOutputResponse }> {
  const { project } = access;
  if (!await canWriteVersion(tx, access.accountId, project)) return { status: "forbidden" };
  const outputs = schema.mapProjectOutputs;
  const [prior] = await tx.select().from(outputs).where(eq(outputs.requestId, requestId));
  if (prior) return prior.projectId === project.id ? { status: "replayed", response: await outputResponse(tx, prior.versionId, prior.changes) }
    : { status: "conflict" };
  // Inget har ändrats sedan förra versionen: samma version igen i stället för en dubblett.
  const [latest] = await tx.select().from(outputs).where(eq(outputs.projectId, project.id)).orderBy(desc(outputs.createdAt)).limit(1);
  if (latest && latest.seq === project.seq) return { status: "ok", replayed: true, response: await outputResponse(tx, latest.versionId, latest.changes) };
  const { changes, authors } = await savedChanges(tx, project);
  if (changes.length === 0) return { status: "ok", replayed: false, response: { formatVersion: 1, status: "empty" } };
  const file = await baseFile(tx, project);
  if (!file) return { status: "not-found" };
  const names = authors.length ? (await tx.select({ name: schema.userAccounts.displayName }).from(schema.userAccounts)
    .where(inArray(schema.userAccounts.id, authors))).map(row => row.name).sort((a, b) => a.localeCompare(b, "sv")) : [];
  return { status: "ready", project, ...file, changes, names };
}

export async function writeMapProjectVersion(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date())
  : Promise<OutputResult> {
  const parsed = mapProjectOutputRequestSchema.safeParse(input.request);
  const prepared = await db.transaction(async tx => {
    // Behörigheten först: den som inte får skriva får samma svar oavsett kroppen.
    const access = await requireMapProject(tx, input, now, "manage", false);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    return prepare(tx, access, parsed.data.requestId);
  });
  if (prepared.status === "replayed") return { status: "ok", replayed: true, response: prepared.response };
  if (prepared.status !== "ready") return prepared;

  const { project, base, bytes, changes, names } = prepared;
  const refused = (code: string, message: string): OutputResult => ({ status: "ok", replayed: false,
    response: { formatVersion: 1, status: "refused", refusals: [{ code, message }] } });
  const map = readBase(bytes, base.fileName);
  if (!map) return refused("UNSAFE_FILE", "Grundfilen går inte att läsa.");
  const written = applyMapRevision(bytes, toChangeSet(map, project.baseSha256, project.baseFormat, changes));
  if (!written.ok) {
    return { status: "ok", replayed: false, response: { formatVersion: 1, status: "refused",
      refusals: written.refusals.slice(0, 50).map(refusal => ({ code: refusal.code, message: refusal.message })) } };
  }
  if (written.bytes.byteLength === 0 || written.bytes.byteLength > CLUB_ARCHIVE_MAP_MAX_BYTES ||
    mapFileFormatOf(written.bytes.subarray(0, 4096)) !== project.baseFormat) {
    return refused("VERIFY_FAILED", "Den skrivna filen är inte en kartfil i samma format som grundfilen.");
  }
  const counts = changeCounts(changes);
  const report = written.report;
  const note = revisionNote(names, counts.total);
  const date = now.toISOString().slice(0, 10);
  const fileName = revisedFileName(base.fileName, date, project.baseFormat).slice(0, 200);
  return db.transaction(async (tx): Promise<OutputResult> => {
    const access = await requireMapProject(tx, input, now, "manage", true);
    if (access.status !== "ok") return access;
    if (!await canWriteVersion(tx, access.accountId, access.project)) return { status: "forbidden" };
    // Någon hann ändra medan filen skrevs: inget sparas (försök igen så kommer ändringen med).
    if (access.project.seq !== project.seq) return { status: "conflict" };
    const stored = await storeMapContent(tx, written.bytes, access.accountId, now, mapStorageQuota());
    if (stored.status === "quota") return refused("QUOTA", "Kvoten för kartfiler är full.");
    const versionId = randomUUID();
    await tx.insert(schema.clubMapVersions).values({ id: versionId, clubId: project.clubId, mapId: base.mapId, contentSha256: stored.sha256, fileName,
      format: project.baseFormat, byteLength: written.bytes.byteLength, versionDate: date, note, uploadedBy: access.accountId, uploadedAt: now,
      sourcePath: null });
    await tx.insert(schema.mapProjectOutputs).values({ id: randomUUID(), projectId: project.id, versionId, seq: project.seq, changes: counts.total,
      createdBy: access.accountId, createdAt: now, requestId: parsed.success ? parsed.data.requestId : randomUUID() });
    await clubJournal(tx, { clubId: project.clubId, action: "MAP_PROJECT_VERSION_CREATED", actorAccountId: access.accountId,
      details: { projectId: project.id, baseVersionId: project.baseVersionId, versionId, changes: counts.total, edits: report.edits.length,
        identicalBytes: report.verification.identicalBytes }, now });
    return { status: "ok", replayed: false, response: { formatVersion: 1, status: "created", versionId, fileName, changes: counts.total,
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
    return { status: "ready", project: access.project, ...file, changes: (await savedChanges(tx, access.project)).changes } as const;
  });
  if (loaded.status !== "ready") return loaded;
  const map = readBase(loaded.bytes, loaded.base.fileName);
  if (!map) return { status: "not-found" };
  const stem = loaded.base.fileName.replace(/\.[A-Za-z0-9]{2,5}$/, "").slice(0, 120) || "karta";
  if (input.format === "geojson") {
    return { status: "ok", fileName: `${stem} ändringar.geojson`, contentType: "application/geo+json",
      body: JSON.stringify(changesGeoJson(map, loaded.changes, stem)) };
  }
  const text = new TextDecoder("utf-8").decode(loaded.bytes).replace(/^\uFEFF/, "");
  const body = mapperChangesFile(text, map, loaded.changes);
  return body === undefined ? { status: "not-found" }
    : { status: "ok", fileName: `${stem} ändringar.xmap`, contentType: "application/xml", body };
}

