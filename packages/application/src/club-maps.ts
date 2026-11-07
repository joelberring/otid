import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  CLUB_ARCHIVE_MAP_MAX_BYTES, clubMapUpdateRequestSchema, clubMapVersionMoveRequestSchema, clubMapVersionUpdateRequestSchema,
  RACE_MAP_MAX_BYTES, raceMapSourceMetadataSchema, type MapAgreement, type RaceMapProblem
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { deriveRasterGeoreference, RasterGeoreferenceError } from "@o-tid/domain";
import { clubJournal, requireClubArea, requireClubRole, type ClubFailure, type ClubProof, type ClubTransaction } from "./club-access";
import { mayUseClubMap } from "./club-map-use";
import { clubLinkFacts } from "./club-affiliation-access";
import { imageDimensions } from "./image-dimensions";
import {
  contentHead, contentLength, discardStagedMapContent, MAP_CONTENT_HEAD_BYTES, mapStorageQuota, stageMapContent, storeMapContent,
  type MapContentInput, type MapQuotaExceeded, type StagedMapContent
} from "./map-content";
import { mapFileFormatOf, saveRaceMapSourceAsAdmin } from "./race-map-source";
import { UUID_PATTERN } from "./serialization";
import type { DbExecutor } from "./snapshot";
import { leaderMembership } from "./training-group-access";

/**
 * ADR-0194 beslut 2, 4, 5 och 8: klubbens kartor. Rättigheterna hör till den logiska kartan; versionerna är filer i
 * kartinnehållet. Slå ihop, flytta en version, ny version (uppladdning som ström), originalet, kartan till en tävling
 * ("Använd igen", bara bilden laddas upp) och till en träningsgrupps kartbibliotek.
 */
const validId = (id: string) => UUID_PATTERN.test(id);

/** Avtalet på kartorna i träningsgruppernas bibliotek som kommer från klubbens karta, och tävlingarna som valt dem. */
async function propagateAgreement(tx: DbExecutor, clubMapId: string, agreement: MapAgreement, now: Date): Promise<void> {
  const groupMaps = (await tx.update(schema.trainingGroupMaps).set({ ...agreement, updatedAt: now })
    .where(eq(schema.trainingGroupMaps.clubMapId, clubMapId)).returning({ id: schema.trainingGroupMaps.id })).map(row => row.id);
  if (groupMaps.length === 0) return;
  await tx.update(schema.raceMapAgreements).set({ ...agreement, updatedAt: now })
    .where(inArray(schema.raceMapAgreements.sourceMapId, groupMaps));
}

export async function updateClubMap(db: Database, input: ClubProof & { clubId: string; mapId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok" }> {
  const parsed = clubMapUpdateRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "ADMIN", now, true);
    if (member.status !== "ok") return member;
    // Inloggningen och behörigheten prövas före kroppen (städrundan 2026-11-07): utloggad får 401, inte 400.
    if (!parsed.success || !validId(input.mapId)) return { status: "invalid-request" } as const;
    const agreement = parsed.data.agreement.ownership === "CLUB" ? { ...parsed.data.agreement, ownerKind: parsed.data.agreement.ownerKind ?? "CLUB" }
      : parsed.data.agreement;
    const texts = { ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.maker !== undefined ? { maker: parsed.data.maker } : {}) };
    const [row] = await tx.update(schema.clubMaps).set({ name: parsed.data.name, ...agreement, ...texts, updatedAt: now })
      .where(and(eq(schema.clubMaps.id, input.mapId), eq(schema.clubMaps.clubId, input.clubId))).returning({ id: schema.clubMaps.id });
    if (!row) return { status: "not-found" } as const;
    await propagateAgreement(tx, row.id, agreement, now);
    await clubJournal(tx, { clubId: input.clubId, action: "CLUB_MAP_UPDATED", actorAccountId: member.accountId, details: { mapId: row.id }, now });
    return { status: "ok" } as const;
  });
}

async function clubMap(tx: DbExecutor, clubId: string, mapId: string) {
  const [map] = await tx.select().from(schema.clubMaps).where(and(eq(schema.clubMaps.id, mapId), eq(schema.clubMaps.clubId, clubId))).for("update");
  return map;
}

/** Kartan tas bort när den inte har några versioner kvar; grupper som pekade på den pekar på `replacement`. */
async function removeIfEmpty(tx: ClubTransaction, mapId: string, replacement: string): Promise<void> {
  const [left] = await tx.select({ id: schema.clubMapVersions.id }).from(schema.clubMapVersions).where(eq(schema.clubMapVersions.mapId, mapId)).limit(1);
  if (left) return;
  await tx.update(schema.trainingGroupMaps).set({ clubMapId: replacement }).where(eq(schema.trainingGroupMaps.clubMapId, mapId));
  await tx.delete(schema.clubMaps).where(eq(schema.clubMaps.id, mapId));
}

/** "Flytta till …" eller "Ny karta": versionen byter karta (dela upp en gissning som blev fel). */
export async function moveClubMapVersion(db: Database, input: ClubProof & { clubId: string; versionId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; mapId: string }> {
  const parsed = clubMapVersionMoveRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "ADMIN", now, true);
    if (member.status !== "ok") return member;
    // Inloggningen och behörigheten prövas före kroppen (städrundan 2026-11-07): utloggad får 401, inte 400.
    if (!parsed.success || !validId(input.versionId)) return { status: "invalid-request" } as const;
    const [version] = await tx.select().from(schema.clubMapVersions)
      .where(and(eq(schema.clubMapVersions.id, input.versionId), eq(schema.clubMapVersions.clubId, input.clubId))).for("update");
    if (!version) return { status: "not-found" } as const;
    const source = await clubMap(tx, input.clubId, version.mapId);
    if (!source) return { status: "not-found" } as const;
    let targetId = parsed.data.targetMapId;
    if (targetId) {
      if (!await clubMap(tx, input.clubId, targetId)) return { status: "not-found" } as const;
    } else {
      targetId = randomUUID();
      // Den nya kartan får samma rättigheter som den gamla (det är troligen samma ägare); de går att ändra.
      await tx.insert(schema.clubMaps).values({ ...source, id: targetId, name: parsed.data.newMapName!, importKey: null, createdAt: now,
        createdBy: member.accountId, updatedAt: now });
    }
    if (targetId === source.id) return { status: "ok", mapId: targetId } as const;
    await tx.update(schema.clubMapVersions).set({ mapId: targetId }).where(eq(schema.clubMapVersions.id, version.id));
    await removeIfEmpty(tx, source.id, targetId);
    await clubJournal(tx, { clubId: input.clubId, action: "CLUB_MAP_VERSION_MOVED", actorAccountId: member.accountId,
      details: { versionId: version.id, from: source.id, to: targetId }, now });
    return { status: "ok", mapId: targetId } as const;
  });
}

export async function updateClubMapVersion(db: Database, input: ClubProof & { clubId: string; versionId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok" }> {
  const parsed = clubMapVersionUpdateRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "ADMIN", now, true);
    if (member.status !== "ok") return member;
    // Inloggningen och behörigheten prövas före kroppen (städrundan 2026-11-07): utloggad får 401, inte 400.
    if (!parsed.success || !validId(input.versionId)) return { status: "invalid-request" } as const;
    const extra = { ...(parsed.data.versionYear !== undefined ? { versionYear: parsed.data.versionYear } : {}),
      ...(parsed.data.maker !== undefined ? { maker: parsed.data.maker } : {}) };
    const [row] = await tx.update(schema.clubMapVersions).set({ versionDate: parsed.data.versionDate, note: parsed.data.note, ...extra })
      .where(and(eq(schema.clubMapVersions.id, input.versionId), eq(schema.clubMapVersions.clubId, input.clubId))).returning({ id: schema.clubMapVersions.id });
    if (!row) return { status: "not-found" } as const;
    await clubJournal(tx, { clubId: input.clubId, action: "CLUB_MAP_VERSION_UPDATED", actorAccountId: member.accountId, details: { versionId: row.id }, now });
    return { status: "ok" } as const;
  });
}

export type ClubMapUploadResult = ClubFailure | { status: "problem"; problem: "TOO_LARGE" | "INVALID_MAP_FILE" | "EMPTY" | "DUPLICATE" }
  | { status: "quota"; quota: MapQuotaExceeded } | { status: "created"; mapId: string; versionId: string };

/**
 * Ny version av en karta (eller en ny karta med sin första version) när kartan revideras. Filen strömmas till kartinnehållet
 * medan den laddas upp; inloggningen och rollen kontrolleras före och efter. Samma innehåll som redan är en version i klubben
 * avvisas (`DUPLICATE`).
 */
export async function uploadClubMapVersion(db: Database, input: ClubProof & { clubId: string; mapId: string | null; newMapName: string | null;
  fileName: string; versionDate: string | null; note: string | null; body: AsyncIterable<Uint8Array> }, now = new Date()): Promise<ClubMapUploadResult> {
  if ((input.mapId === null) === (input.newMapName === null) || (input.mapId !== null && !validId(input.mapId))) return { status: "invalid-request" };
  const name = input.newMapName?.trim().slice(0, 120) ?? null;
  if (input.newMapName !== null && !name) return { status: "invalid-request" };
  if (input.versionDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.versionDate)) return { status: "invalid-request" };
  const before = await db.transaction(tx => requireClubRole(tx, input, "ADMIN", now, true));
  if (before.status !== "ok") return before;
  const staged = await stageMapContent(db, input.body, { maxBytes: CLUB_ARCHIVE_MAP_MAX_BYTES, now });
  if (staged.kind === "too-large") return { status: "problem", problem: "TOO_LARGE" };
  if (staged.kind === "empty") return { status: "problem", problem: "EMPTY" };
  try {
    const format = mapFileFormatOf(staged.head);
    if (!format) return { status: "problem", problem: "INVALID_MAP_FILE" };
    return await db.transaction(async tx => {
      const member = await requireClubRole(tx, input, "ADMIN", now, true);
      if (member.status !== "ok") return member;
      const [duplicate] = await tx.select({ id: schema.clubMapVersions.id }).from(schema.clubMapVersions)
        .where(and(eq(schema.clubMapVersions.clubId, input.clubId), eq(schema.clubMapVersions.contentSha256, staged.sha256)));
      if (duplicate) return { status: "problem", problem: "DUPLICATE" } as const;
      let mapId = input.mapId;
      if (mapId) {
        if (!await clubMap(tx, input.clubId, mapId)) return { status: "not-found" } as const;
      } else {
        mapId = randomUUID();
        await tx.insert(schema.clubMaps).values({ id: mapId, clubId: input.clubId, name: name!, ownership: "CLUB", ownerKind: "CLUB", trainingOnly: false,
          feePerPrint: false, noPublicDisplay: false, createdAt: now, createdBy: member.accountId, updatedAt: now });
      }
      const stored = await storeMapContent(tx, staged, member.accountId, now, mapStorageQuota());
      if (stored.status === "quota") throw new QuotaRollback(stored.quota);
      const versionId = randomUUID();
      const fileName = input.fileName.replace(/\p{Cc}/gu, "").trim().slice(0, 200) || (format === "OCD" ? "karta.ocd" : "karta.omap");
      await tx.insert(schema.clubMapVersions).values({ id: versionId, clubId: input.clubId, mapId, contentSha256: stored.sha256, fileName, format,
        byteLength: staged.byteLength, versionDate: input.versionDate ?? now.toISOString().slice(0, 10), note: input.note?.trim().slice(0, 500) || null,
        uploadedBy: member.accountId, uploadedAt: now, sourcePath: null });
      await clubJournal(tx, { clubId: input.clubId, action: "CLUB_MAP_VERSION_UPLOADED", actorAccountId: member.accountId,
        details: { mapId, versionId, byteLength: staged.byteLength }, now });
      return { status: "created", mapId, versionId } as const;
    }).catch((error: unknown) => {
      if (error instanceof QuotaRollback) return { status: "quota", quota: error.quota } as const;
      throw error;
    });
  } finally {
    await discardStagedMapContent(db, staged.contentId);
  }
}

class QuotaRollback extends Error {
  constructor(readonly quota: MapQuotaExceeded) { super("Kvoten för kartor är full"); }
}

/** Versionen med innehållets id (för strömmen) när kontot är medlem i klubben. */
export async function readClubMapVersionHead(db: Database, input: ClubProof & { clubId: string; versionId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; fileName: string; format: "OCD" | "OMAP"; byteLength: number; contentId: string; sha256: string }> {
  if (!validId(input.versionId)) return { status: "not-found" };
  return db.transaction(async tx => {
    const member = await requireClubArea(tx, input, "MAP_BANK", now, false);
    if (member.status !== "ok") return member;
    const [row] = await tx.select({ fileName: schema.clubMapVersions.fileName, format: schema.clubMapVersions.format,
      byteLength: schema.clubMapVersions.byteLength, contentId: schema.mapContents.contentId, sha256: schema.clubMapVersions.contentSha256 })
      .from(schema.clubMapVersions).innerJoin(schema.mapContents, eq(schema.mapContents.sha256, schema.clubMapVersions.contentSha256))
      .where(and(eq(schema.clubMapVersions.id, input.versionId), eq(schema.clubMapVersions.clubId, input.clubId)));
    return row ? { status: "ok", ...row } as const : { status: "not-found" } as const;
  });
}

/** Innehållet del för del (1 MiB), en fråga per del, så att webben aldrig håller hela kartfilen. */
export async function* streamMapContentParts(db: DbExecutor, contentId: string): AsyncGenerator<Uint8Array> {
  for (let part = 0; ; part++) {
    const rows = (await db.execute<{ data: Buffer }>(sql`select data from map_content_part where content_id = ${contentId} and part = ${part}`)).rows;
    const data = rows[0]?.data;
    if (!data) return;
    yield new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
}

/** Kartinnehållet som redan finns, som en "uppladdning" utan ny kopia (tävlingens kartfil pekar på samma innehåll). */
async function existingContent(tx: DbExecutor, sha256: string): Promise<StagedMapContent | undefined> {
  const [row] = (await tx.execute<{ content_id: string; byte_length: number; head: Buffer | null }>(sql`select c.content_id, c.byte_length,
      substring(p.data from 1 for ${MAP_CONTENT_HEAD_BYTES}) as head
    from map_content c left join map_content_part p on p.content_id = c.content_id and p.part = 0 where c.sha256 = ${sha256}`)).rows;
  if (!row?.head) return undefined;
  return { kind: "staged", contentId: row.content_id, sha256, byteLength: Number(row.byte_length), head: new Uint8Array(row.head) };
}

async function versionWithMap(tx: DbExecutor, clubId: string, versionId: string) {
  const [row] = await tx.select({ version: schema.clubMapVersions, map: schema.clubMaps }).from(schema.clubMapVersions)
    .innerJoin(schema.clubMaps, eq(schema.clubMaps.id, schema.clubMapVersions.mapId))
    .where(and(eq(schema.clubMapVersions.id, versionId), eq(schema.clubMapVersions.clubId, clubId)));
  return row;
}

const agreementOf = (map: typeof schema.clubMaps.$inferSelect): MapAgreement => ({ ownership: map.ownership, ownerKind: map.ownerKind,
  ownerName: map.ownerName, agreement: map.agreement, validUntil: map.validUntil, contact: map.contact, trainingOnly: map.trainingOnly,
  feePerPrint: map.feePerPrint, noPublicDisplay: map.noPublicDisplay });

export type ClubMapToRaceResult = ClubFailure | { status: "problem"; problem: RaceMapProblem; quota?: MapQuotaExceeded }
  | { status: "ok"; georeferenced: boolean };

/**
 * "Använd igen" (beslut 4): klubbens kartversion blir tävlingens kartfil. Webbläsaren har ritat bilden ur arkivets fil;
 * kartfilen laddas inte upp igen utan tävlingen pekar på samma innehåll. Kräver medlem i klubben och admin på tävlingen
 * (`saveRaceMapSourceAsAdmin` kontrollerar tävlingen). Kartans rättigheter följer med till tävlingen.
 */
export async function saveClubMapVersionToRace(db: Database, input: ClubProof & { clubId: string; versionId: string; raceId: string;
  image: MapContentInput; metadata: unknown }, now = new Date()): Promise<ClubMapToRaceResult> {
  if (!validId(input.versionId) || !validId(input.raceId)) return { status: "invalid-request" };
  const found = await db.transaction(async tx => {
    const member = await requireClubArea(tx, input, "MAP_BANK", now, false);
    if (member.status !== "ok") return member;
    const row = await versionWithMap(tx, input.clubId, input.versionId);
    if (!row) return { status: "not-found" } as const;
    // ADR-0210 beslut 7: samma beslut som "Välj karta från klubbarkivet".
    if (!mayUseClubMap({ role: member.role, clubId: input.clubId, mapBank: (await clubLinkFacts(tx, input.clubId)).access.MAP_BANK },
      { mapId: row.map.id, ...agreementOf(row.map) })) return { status: "forbidden" } as const;
    const file = await existingContent(tx, row.version.contentSha256);
    return file ? { status: "ok", row, file } as const : { status: "not-found" } as const;
  });
  if (found.status !== "ok") return found;
  // Kartan och kartavtalet i samma transaktion: misslyckas avtalet sparas inte kartan heller.
  const values = { sourceMapId: null, mapName: found.row.map.name, ...agreementOf(found.row.map), updatedAt: now };
  return saveRaceMapSourceAsAdmin(db, { raceId: input.raceId, sessionToken: input.sessionToken, csrfCookie: input.csrfCookie ?? null,
    csrfHeader: input.csrfHeader ?? null, file: found.file, fileName: found.row.version.fileName, image: input.image, metadata: input.metadata,
    alsoSave: async tx => {
      await tx.insert(schema.raceMapAgreements).values({ raceId: input.raceId, ...values })
        .onConflictDoUpdate({ target: schema.raceMapAgreements.raceId, set: { ...values, publicUseAcknowledgedAt: null, publicUseAcknowledgedBy: null } });
    } }, now);
}

export type ClubMapToGroupResult = ClubFailure | { status: "problem"; problem: RaceMapProblem } | { status: "quota"; quota: MapQuotaExceeded }
  | { status: "saved"; mapId: string; updated: boolean };

/**
 * Beslut 5: klubbens karta (en version, normalt den senaste) i en träningsgrupps kartbibliotek. Finns kartan redan i gruppen
 * (samma klubbkarta) byts dess bild och fil mot versionen ("Uppdatera i gruppen"); rättigheterna följer klubbens karta.
 * Kräver medlem i klubben och ledare i gruppen.
 */
export async function saveClubMapToGroupLibrary(db: Database, input: ClubProof & { clubId: string; versionId: string; groupId: string;
  image: MapContentInput; metadata: unknown }, now = new Date()): Promise<ClubMapToGroupResult> {
  if (!validId(input.versionId) || !validId(input.groupId)) return { status: "invalid-request" };
  const metadata = raceMapSourceMetadataSchema.safeParse(input.metadata);
  if (!metadata.success) return { status: "invalid-request" };
  if (contentLength(input.image) > RACE_MAP_MAX_BYTES) return { status: "problem", problem: "IMAGE_TOO_LARGE" };
  const image = imageDimensions(contentHead(input.image));
  if (!image || image.mediaType !== "image/png") return { status: "problem", problem: "INVALID_IMAGE" };
  let transform: { a: number; b: number; c: number; d: number; e: number; f: number } | null = null;
  if (metadata.data.tiePoints) {
    try { transform = { ...deriveRasterGeoreference({ imageWidth: image.width, imageHeight: image.height, tiePoints: metadata.data.tiePoints }).transform }; }
    catch (error) {
      if (error instanceof RasterGeoreferenceError) return { status: "problem", problem: "INVALID_GEOREFERENCE" };
      throw error;
    }
  }
  return db.transaction(async tx => {
    const member = await requireClubArea(tx, input, "MAP_BANK", now, true);
    if (member.status !== "ok") return member;
    if (!await leaderMembership(tx, { accountId: member.accountId, groupId: input.groupId }, "update")) return { status: "not-found" } as const;
    const row = await versionWithMap(tx, input.clubId, input.versionId);
    if (!row) return { status: "not-found" } as const;
    if (row.version.format !== metadata.data.format) return { status: "invalid-request" } as const;
    const stored = await storeMapContent(tx, input.image, member.accountId, now, mapStorageQuota());
    if (stored.status === "quota") return { status: "quota", quota: stored.quota } as const;
    const agreement = agreementOf(row.map);
    const [existing] = await tx.select({ id: schema.trainingGroupMaps.id }).from(schema.trainingGroupMaps)
      .where(and(eq(schema.trainingGroupMaps.groupId, input.groupId), eq(schema.trainingGroupMaps.clubMapId, row.map.id))).limit(1);
    const mapId = existing?.id ?? randomUUID();
    const imageFields = { fileName: `${row.version.fileName.replace(/\.[^.]{1,8}$/, "")}.png`.slice(0, 200), sha256: stored.sha256,
      contentSha256: stored.sha256, byteLength: contentLength(input.image), width: image.width, height: image.height, transform, updatedAt: now };
    if (existing) {
      await tx.update(schema.trainingGroupMaps).set({ name: row.map.name, ...agreement, ...imageFields }).where(eq(schema.trainingGroupMaps.id, mapId));
      await tx.execute(sql`update training_group_map set media_type = 'image/png', image = null,
        tie_points = ${metadata.data.tiePoints ? JSON.stringify(metadata.data.tiePoints) : null}::jsonb where id = ${mapId}`);
      await tx.delete(schema.trainingGroupMapSources).where(eq(schema.trainingGroupMapSources.mapId, mapId));
    } else {
      await tx.execute(sql`insert into training_group_map (id, group_id, name, ownership, owner_kind, owner_name, agreement, valid_until, contact,
          training_only, fee_per_print, no_public_display, file_name, media_type, image, content_sha256, sha256, byte_length, width, height, tie_points,
          transform, source_race_id, club_map_id, created_at, created_by, updated_at, request_id)
        values (${mapId}, ${input.groupId}, ${row.map.name}, ${agreement.ownership}, ${agreement.ownerKind}, ${agreement.ownerName}, ${agreement.agreement},
          ${agreement.validUntil}, ${agreement.contact}, ${agreement.trainingOnly}, ${agreement.feePerPrint}, ${agreement.noPublicDisplay},
          ${imageFields.fileName}, 'image/png', null, ${stored.sha256}, ${stored.sha256}, ${imageFields.byteLength}, ${image.width}, ${image.height},
          ${metadata.data.tiePoints ? JSON.stringify(metadata.data.tiePoints) : null}::jsonb, ${transform ? JSON.stringify(transform) : null}::jsonb,
          null, ${row.map.id}, ${now}, ${member.accountId}, ${now}, ${randomUUID()})`);
    }
    const m = metadata.data;
    await tx.execute(sql`insert into training_group_map_source (map_id, file_name, format, version, file, content_sha256, sha256, byte_length, scale,
        bounds, georeference, render, summary)
      values (${mapId}, ${row.version.fileName}, ${row.version.format}, ${m.version}, null, ${row.version.contentSha256}, ${row.version.contentSha256},
        ${row.version.byteLength}, ${m.scale}, ${JSON.stringify(m.bounds)}::jsonb, ${m.georeference ? JSON.stringify(m.georeference) : null}::jsonb,
        ${JSON.stringify(m.render)}::jsonb, ${JSON.stringify(m.summary)}::jsonb)`);
    await clubJournal(tx, { clubId: input.clubId, action: existing ? "CLUB_MAP_GROUP_UPDATED" : "CLUB_MAP_ADDED_TO_GROUP", actorAccountId: member.accountId,
      details: { mapId: row.map.id, versionId: row.version.id, groupId: input.groupId }, now });
    return { status: "saved", mapId, updated: existing !== undefined } as const;
  });
}

/** Grupper där kontot är ledare (för "Lägg i gruppens kartbibliotek" och "Använd igen" i en grupp). */
export async function leaderGroups(tx: DbExecutor, accountId: string): Promise<{ groupId: string; name: string }[]> {
  const rows = await tx.select({ groupId: schema.trainingGroups.id, name: schema.trainingGroups.name }).from(schema.trainingGroupMembers)
    .innerJoin(schema.trainingGroups, eq(schema.trainingGroups.id, schema.trainingGroupMembers.groupId))
    .where(and(eq(schema.trainingGroupMembers.accountId, accountId), eq(schema.trainingGroupMembers.role, "LEADER"))).limit(200);
  return rows;
}

