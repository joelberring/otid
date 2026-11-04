import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { CLUB_ARCHIVE_MAP_MAX_BYTES, mapRevisionVersionRequestSchema, type MapRevisionWriteProblem } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { changeCounts, changeSet, parseObjectRef, validState, type KeyedState, type MapRevisionChangeSet, type ObjectKey } from "@o-tid/map-revision";
import { clubJournal, type ClubFailure, type ClubProof } from "./club-access";
import { mapStorageQuota, readMapContent, storeMapContent } from "./map-content";
import { newerVersion, requireRevision } from "./map-revisions";
import { mapFileFormatOf } from "./race-map-source";

/**
 * ADR-0208 beslut 6: "Skapa ny kartversion". Servern bygger ändringarna ur det som är sparat (inte ur det klienten skickar),
 * ger dem till skrivaren i `@o-tid/map-file` (grenen kartfil-skrivning: lappar filen och läser den igen) och sparar resultatet
 * som en **ny** version av samma karta med anteckningen "Reviderad av …, n ändringar". Grundversionen ändras aldrig.
 *
 * Skrivaren körs utanför transaktionen. Har någon ändrat under tiden (revideringens löpnummer har ändrats) sparas inget och
 * svaret säger det. Vägrar skrivaren, eller går kontrollen efteråt inte igenom, sparas inget och skälet visas som det är.
 * Har kartan fått en nyare version på annat håll sedan revideringen startade skapas ingen version: ändringarna exporteras i
 * stället (beslut 7), så att ingen tyst tappar den andra versionens ändringar.
 */
export type MapRevisionWriteResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly verification: readonly string[] }
  | { readonly ok: false; readonly problem: "WRITER_UNAVAILABLE" | "WRITER_REFUSED" | "VERIFICATION_FAILED"; readonly detail: string };

export interface MapRevisionWriter {
  write(input: { readonly base: Uint8Array; readonly changes: MapRevisionChangeSet; readonly fileName: string }): Promise<MapRevisionWriteResult>;
}

/** Tills grenen kartfil-skrivning är ihopslagen finns ingen skrivare: svaret säger det och exporten erbjuds. */
export const unavailableMapRevisionWriter: MapRevisionWriter = {
  write: async () => ({ ok: false, problem: "WRITER_UNAVAILABLE",
    detail: "Att skriva tillbaka till kartfilen är inte klart i den här versionen av O-Tid. Exportera ändringarna i stället." })
};

export type MapRevisionVersionResult = ClubFailure
  | { status: "problem"; problem: MapRevisionWriteProblem; detail: string | null }
  | { status: "created"; replayed: boolean; versionId: string; fileName: string; note: string; changes: number; verification: readonly string[] };

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

/** "Skogen V11.ocd" → "Skogen V11 reviderad 2026-11-03.ocd". */
export function revisedFileName(fileName: string, date: string, format: "OCD" | "OMAP"): string {
  const match = /^(.*?)(\.[A-Za-z0-9]{2,5})?$/.exec(fileName.trim());
  const stem = (match?.[1] || "karta").slice(0, 160);
  const extension = match?.[2] ?? (format === "OCD" ? ".ocd" : ".omap");
  return `${stem} reviderad ${date}${extension}`;
}

export async function createMapRevisionVersion(db: Database, input: ClubProof & { clubId: string; revisionId: string; request: unknown;
  writer: MapRevisionWriter }, now = new Date()): Promise<MapRevisionVersionResult> {
  const parsed = mapRevisionVersionRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const prepared = await db.transaction(async tx => {
    const access = await requireRevision(tx, input, now, "manage", false);
    if (access.status !== "ok") return access;
    const revision = access.revision;
    if (revision.resultVersionId) {
      const [version] = await tx.select().from(schema.clubMapVersions).where(eq(schema.clubMapVersions.id, revision.resultVersionId));
      if (version) return { status: "replayed", versionId: version.id, fileName: version.fileName, note: version.note ?? "" } as const;
    }
    if (revision.status !== "OPEN") return { status: "problem", problem: "CLOSED", detail: null } as const;
    const newer = await newerVersion(tx, revision);
    if (newer) return { status: "problem", problem: "NEWER_VERSION", detail: newer.fileName } as const;
    const rows = await tx.select().from(schema.mapRevisionObjects).where(eq(schema.mapRevisionObjects.revisionId, revision.id));
    const states: [ObjectKey, KeyedState][] = rows.flatMap(row => {
      const ref = row.ref === null ? null : parseObjectRef(row.ref);
      return validState(row.state) && (row.ref === null || ref) ? [[row.objectKey, { ref: ref ?? null, state: row.state }] as [ObjectKey, KeyedState]] : [];
    });
    const changes = changeSet(revision.baseSha256, revision.baseFormat, states);
    if (changes.changes.length === 0) return { status: "problem", problem: "NO_CHANGES", detail: null } as const;
    const authors = [...new Set(rows.filter(row => (row.state as { kind?: string }).kind !== "UNCHANGED").map(row => row.authorAccountId))];
    const names = authors.length ? (await tx.select({ id: schema.userAccounts.id, name: schema.userAccounts.displayName }).from(schema.userAccounts)
      .where(inArray(schema.userAccounts.id, authors))).map(row => row.name).sort((a, b) => a.localeCompare(b, "sv")) : [];
    const [base] = await tx.select().from(schema.clubMapVersions).where(eq(schema.clubMapVersions.id, revision.baseVersionId));
    const bytes = await readMapContent(tx, revision.baseSha256);
    if (!base || !bytes) return { status: "not-found" } as const;
    return { status: "ready", revision, base, bytes, changes, names } as const;
  });
  if (prepared.status === "replayed") {
    return { status: "created", replayed: true, versionId: prepared.versionId, fileName: prepared.fileName, note: prepared.note, changes: 0, verification: [] };
  }
  if (prepared.status !== "ready") return prepared;

  const written = await input.writer.write({ base: new Uint8Array(prepared.bytes), changes: prepared.changes, fileName: prepared.base.fileName });
  if (!written.ok) return { status: "problem", problem: written.problem, detail: written.detail };
  if (written.bytes.byteLength === 0 || written.bytes.byteLength > CLUB_ARCHIVE_MAP_MAX_BYTES ||
    mapFileFormatOf(written.bytes.subarray(0, 4096)) !== prepared.revision.baseFormat) {
    return { status: "problem", problem: "VERIFICATION_FAILED", detail: "Den skrivna filen är inte en kartfil i samma format som grundfilen." };
  }

  const count = changeCounts(prepared.changes.changes).total;
  const note = revisionNote(prepared.names, count);
  const date = now.toISOString().slice(0, 10);
  const fileName = revisedFileName(prepared.base.fileName, date, prepared.revision.baseFormat).slice(0, 200);
  return db.transaction(async tx => {
    const access = await requireRevision(tx, input, now, "manage", true);
    if (access.status !== "ok") return access;
    const revision = access.revision;
    if (revision.status !== "OPEN" || revision.resultVersionId) return { status: "problem", problem: "CLOSED", detail: null } as const;
    // Någon hann ändra medan filen skrevs: inget sparas (försök igen så kommer ändringen med).
    if (revision.seq !== prepared.revision.seq) return { status: "conflict" } as const;
    const stored = await storeMapContent(tx, written.bytes, access.accountId, now, mapStorageQuota());
    if (stored.status === "quota") return { status: "problem", problem: "QUOTA", detail: null } as const;
    const [duplicate] = await tx.select({ id: schema.clubMapVersions.id }).from(schema.clubMapVersions)
      .where(and(eq(schema.clubMapVersions.clubId, input.clubId), eq(schema.clubMapVersions.contentSha256, stored.sha256)));
    if (duplicate) return { status: "problem", problem: "VERIFICATION_FAILED", detail: "Den skrivna filen är exakt en version som redan finns i arkivet." } as const;
    const versionId = randomUUID();
    await tx.insert(schema.clubMapVersions).values({ id: versionId, clubId: input.clubId, mapId: prepared.base.mapId, contentSha256: stored.sha256, fileName,
      format: revision.baseFormat, byteLength: written.bytes.byteLength, versionDate: date, note, uploadedBy: access.accountId, uploadedAt: now,
      sourcePath: null });
    await tx.update(schema.mapRevisions).set({ status: "CLOSED", closedAt: now, closedBy: access.accountId, resultVersionId: versionId })
      .where(eq(schema.mapRevisions.id, revision.id));
    await clubJournal(tx, { clubId: input.clubId, action: "MAP_REVISION_VERSION_CREATED", actorAccountId: access.accountId,
      details: { revisionId: revision.id, baseVersionId: revision.baseVersionId, versionId, changes: count, requestId: parsed.data.requestId,
        verification: written.verification.slice(0, 20) }, now });
    return { status: "created", replayed: false, versionId, fileName, note, changes: count, verification: written.verification } as const;
  });
}
