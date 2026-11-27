import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import {
  publicMapCatalogQuerySchema, upsertPublicMapListingInputSchema, usePublicMapListingRequestSchema,
  type PublicMapBounds, type PublicMapFootprint, type PublicMapListingDetail, type PublicMapListingSummary,
  type PublicMapNorm, type RaceMapProblem
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { countiesForMunicipalities, deriveRasterGeoreference, municipalitiesForBounds, RasterGeoreferenceError, swedishToday } from "@o-tid/domain";
import { clubJournal, requireClubRole, type ClubFailure, type ClubProof } from "./club-access";
import { matchesIfNoneMatch } from "./http-etag";
import { mapProjectBaseFileName, mapProjectCanDownloadSource, mapProjectJournal, requireMapProject } from "./map-project-access";
import { mapStorageQuota, readMapContent, storeMapContent, type MapQuotaExceeded } from "./map-content";
import {
  boundsAndMunicipalitiesFromProjected, detectMapNorm, extractMapMetadata, renderMapContentToPng, type ServerCanvasFactory
} from "./map-render-server";
import { insertEventWithRace } from "./organizer-events";
import { UUID_PATTERN } from "./serialization";
import type { DbExecutor } from "./snapshot";
import { authenticateUserAccountSessionForMutation } from "./user-account";

/**
 * Etapp 3.2: Publik sökbar kartbank (`/kartbank`).
 * Hanterar publik listning, detaljvy, villkorad förhandsvisning (`showPreview === true`),
 * öppen nedladdning (`accessMode === "OPEN_DOWNLOAD"`), "Använd i ny träning" utan källfil
 * (`USE_IN_OTID_LOCKED` / `OPEN_DOWNLOAD`), samt publicering från klubbarkiv och kartprojekt.
 */
type ListingRow = typeof schema.publicMapListings.$inferSelect;

export interface CatalogSuggestedFields {
  readonly title: string;
  readonly description: string;
  readonly clubName: string;
  readonly maker: string;
  readonly scale: number | null;
  readonly norm: PublicMapNorm;
  readonly mapYear: number | null;
  readonly municipalityCodes: string[];
  readonly countyCodes: string[];
  readonly bounds: PublicMapBounds | null;
  readonly footprint: PublicMapFootprint | null;
  readonly latestVersionId?: string | null;
}

const validId = (id: string) => UUID_PATTERN.test(id);

function toSummary(row: ListingRow): PublicMapListingSummary {
  return {
    id: row.id,
    title: row.title,
    clubName: row.clubName,
    maker: row.maker,
    format: row.format,
    accessMode: row.accessMode,
    showPreview: row.showPreview,
    hasPreview: row.showPreview && row.previewContentSha256 !== null,
    previewSha: row.showPreview && row.previewContentSha256 ? row.previewContentSha256.slice(0, 16) : null,
    scale: row.scale,
    norm: row.norm,
    mapYear: row.mapYear,
    municipalityCodes: [...row.municipalityCodes],
    countyCodes: [...row.countyCodes],
    minLon: row.minLon,
    maxLon: row.maxLon,
    minLat: row.minLat,
    maxLat: row.maxLat,
    footprint: row.footprint ?? null,
    publishedAt: row.publishedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toDetail(row: ListingRow): PublicMapListingDetail {
  return {
    ...toSummary(row),
    description: row.description,
    licenseNote: row.licenseNote,
    contact: row.contact,
    clubId: row.clubId,
    clubMapId: row.clubMapId,
    clubMapVersionId: row.clubMapVersionId,
    mapProjectId: row.mapProjectId,
    canDownload: row.accessMode === "OPEN_DOWNLOAD",
    canUseInOtid: row.accessMode === "USE_IN_OTID_LOCKED" || row.accessMode === "OPEN_DOWNLOAD"
  };
}

function safeDownloadFileName(title: string, format: "OCD" | "OMAP"): string {
  const ext = format === "OCD" ? "ocd" : "omap";
  const base = title.replace(/[^\p{L}\p{N} ._()-]/gu, "_").trim().slice(0, 120) || "karta";
  return `${base}.${ext}`;
}

/** Publik listning med filter på kommun, län, kartnorm, tillgänglighet, skala, år, kartutsnitt och fritext. */
export async function listPublicMapListings(db: Database, rawQuery: unknown)
  : Promise<{ status: "invalid-request" } | { status: "ok"; items: PublicMapListingSummary[]; total: number; municipalityCounts: Record<string, number> }> {
  const parsed = publicMapCatalogQuerySchema.safeParse(rawQuery ?? {});
  if (!parsed.success) return { status: "invalid-request" };
  const q = parsed.data;
  const table = schema.publicMapListings;
  const conditions: SQL[] = [];

  if (q.municipality) {
    conditions.push(sql`${q.municipality} = ANY(${table.municipalityCodes})`);
  }
  if (q.county) {
    conditions.push(sql`${q.county} = ANY(${table.countyCodes})`);
  }
  if (q.accessMode) {
    conditions.push(eq(table.accessMode, q.accessMode));
  }
  if (q.norm) {
    conditions.push(eq(table.norm, q.norm));
  }
  if (q.minScale !== undefined) {
    conditions.push(gte(table.scale, q.minScale));
  }
  if (q.maxScale !== undefined) {
    conditions.push(lte(table.scale, q.maxScale));
  }
  if (q.minYear !== undefined) {
    conditions.push(gte(table.mapYear, q.minYear));
  }
  if (q.maxYear !== undefined) {
    conditions.push(lte(table.mapYear, q.maxYear));
  }
  if (q.minLon !== undefined && q.maxLon !== undefined && q.minLat !== undefined && q.maxLat !== undefined) {
    conditions.push(
      sql`${table.minLon} IS NOT NULL AND ${table.maxLon} IS NOT NULL AND ${table.minLat} IS NOT NULL AND ${table.maxLat} IS NOT NULL`,
      lte(table.minLon, q.maxLon),
      gte(table.maxLon, q.minLon),
      lte(table.minLat, q.maxLat),
      gte(table.maxLat, q.minLat)
    );
  }
  if (q.q && q.q.length > 0) {
    const pattern = `%${q.q.replace(/[%_\\]/g, "\\$&")}%`;
    conditions.push(or(
      ilike(table.title, pattern),
      ilike(table.clubName, pattern),
      ilike(table.maker, pattern),
      ilike(table.description, pattern)
    )!);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const [rows, countRows, muniResult] = await Promise.all([
    db.select().from(table).where(whereClause)
      .orderBy(desc(table.updatedAt), desc(table.publishedAt))
      .limit(q.limit)
      .offset(q.offset),
    db.select({ total: sql<number>`count(*)::int` }).from(table).where(whereClause),
    db.execute<{ code: string; cnt: number }>(
      sql`select code, count(*)::int as cnt from public_map_listing, unnest(municipality_codes) as code group by code`
    )
  ]);
  const [countRow] = countRows;
  const muniRows = muniResult.rows;
  const municipalityCounts: Record<string, number> = {};
  for (const row of muniRows) municipalityCounts[row.code] = Number(row.cnt);

  return {
    status: "ok",
    items: rows.map(toSummary),
    total: Number(countRow?.total ?? rows.length),
    municipalityCounts
  };
}

/** Publik detaljvy för en listad karta. */
export async function readPublicMapListing(db: Database, listingId: string)
  : Promise<{ status: "not-found" } | { status: "ok"; listing: PublicMapListingDetail }> {
  if (!validId(listingId)) return { status: "not-found" };
  const [row] = await db.select().from(schema.publicMapListings).where(eq(schema.publicMapListings.id, listingId));
  return row ? { status: "ok", listing: toDetail(row) } : { status: "not-found" };
}

/** Publik förhandsvisningsbild (PNG) — endast när `showPreview === true` och förhandsvisningen finns; prövar ETag före läsning. */
export async function readPublicMapPreview(
  db: Database,
  listingId: string,
  options: { readonly ifNoneMatch?: string | null } = {}
): Promise<{ status: "not-found" } | { status: "not-modified"; sha256: string } | { status: "ok"; png: Buffer; sha256: string }> {
  if (!validId(listingId)) return { status: "not-found" };
  const [row] = await db.select({
    showPreview: schema.publicMapListings.showPreview,
    previewContentSha256: schema.publicMapListings.previewContentSha256
  }).from(schema.publicMapListings).where(eq(schema.publicMapListings.id, listingId));
  if (!row || !row.showPreview || !row.previewContentSha256) return { status: "not-found" };
  if (matchesIfNoneMatch(options.ifNoneMatch, `"${row.previewContentSha256}"`)) {
    return { status: "not-modified", sha256: row.previewContentSha256 };
  }
  const png = await readMapContent(db, row.previewContentSha256);
  if (!png) return { status: "not-found" };
  return { status: "ok", png, sha256: row.previewContentSha256 };
}

/** Publik nedladdning av rå `.ocd`/`.omap` — ENDAST när `accessMode === "OPEN_DOWNLOAD"`. */
export async function downloadPublicMapSource(db: Database, listingId: string)
  : Promise<{ status: "not-found" | "forbidden" } | { status: "ok"; fileName: string; format: "OCD" | "OMAP"; byteLength: number; contentId: string; sha256: string }> {
  if (!validId(listingId)) return { status: "not-found" };
  const [row] = await db.select({
    accessMode: schema.publicMapListings.accessMode,
    title: schema.publicMapListings.title,
    format: schema.publicMapListings.format,
    contentSha256: schema.publicMapListings.contentSha256,
    byteLength: schema.mapContents.byteLength,
    contentId: schema.mapContents.contentId
  })
    .from(schema.publicMapListings)
    .innerJoin(schema.mapContents, eq(schema.mapContents.sha256, schema.publicMapListings.contentSha256))
    .where(eq(schema.publicMapListings.id, listingId));
  if (!row) return { status: "not-found" };
  if (row.accessMode !== "OPEN_DOWNLOAD") return { status: "forbidden" };
  return {
    status: "ok",
    fileName: safeDownloadFileName(row.title, row.format),
    format: row.format,
    byteLength: row.byteLength,
    contentId: row.contentId,
    sha256: row.contentSha256
  };
}

/** Hjälpare för att härleda föreslagna geodata för en klubbkartversion ur versionens kolumner eller fingerprint. */
async function versionGeoSuggestion(tx: DbExecutor, version: typeof schema.clubMapVersions.$inferSelect) {
  let bounds: PublicMapBounds | null =
    version.minLon !== null && version.maxLon !== null && version.minLat !== null && version.maxLat !== null
      ? { minLon: version.minLon, maxLon: version.maxLon, minLat: version.minLat, maxLat: version.maxLat }
      : null;
  let footprint: PublicMapFootprint | null = version.footprint ?? null;
  let scale: number | null = version.scale ?? null;
  let norm: PublicMapNorm = (version.norm as PublicMapNorm | null) ?? detectMapNorm(scale);

  if (!bounds) {
    const [check] = await tx.select({ fingerprint: schema.clubMapVersionChecks.fingerprint })
      .from(schema.clubMapVersionChecks)
      .where(eq(schema.clubMapVersionChecks.versionId, version.id)).limit(1);
    const fp = check?.fingerprint;
    if (fp) {
      if (scale === null && fp.scale) {
        scale = fp.scale;
        norm = detectMapNorm(scale);
      }
      const geo = boundsAndMunicipalitiesFromProjected(fp.projected);
      if (geo) {
        bounds = geo.wgs84Bounds;
        footprint = geo.footprint;
      }
    }
  }
  const municipalityCodes = bounds ? municipalitiesForBounds(bounds) : [];
  const countyCodes = countiesForMunicipalities(municipalityCodes);
  return { bounds, footprint, scale, norm, municipalityCodes, countyCodes };
}

/** Läser publiceringsstatus och förifyllda värden för en klubbkarta (kräver klubb-ADMIN/OWNER). */
export async function readClubMapCatalogStatus(db: Database, input: ClubProof & { clubId: string; mapId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; listing: PublicMapListingDetail | null; suggested: CatalogSuggestedFields }> {
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "ADMIN", now, false);
    if (member.status !== "ok") return member;
    if (!validId(input.mapId)) return { status: "not-found" } as const;
    const [map] = await tx.select().from(schema.clubMaps)
      .where(and(eq(schema.clubMaps.id, input.mapId), eq(schema.clubMaps.clubId, input.clubId)));
    if (!map) return { status: "not-found" } as const;
    const [club] = await tx.select({ name: schema.clubs.name }).from(schema.clubs).where(eq(schema.clubs.id, input.clubId));
    const [latest] = await tx.select().from(schema.clubMapVersions)
      .where(and(eq(schema.clubMapVersions.mapId, map.id), eq(schema.clubMapVersions.clubId, input.clubId)))
      .orderBy(desc(schema.clubMapVersions.versionDate), desc(schema.clubMapVersions.uploadedAt)).limit(1);
    const [existing] = await tx.select().from(schema.publicMapListings)
      .where(eq(schema.publicMapListings.clubMapId, map.id)).limit(1);
    const geo = latest ? await versionGeoSuggestion(tx, latest) : {
      bounds: null, footprint: null, scale: null, norm: "OTHER" as PublicMapNorm, municipalityCodes: [], countyCodes: []
    };
    const mapYear = latest?.versionYear ?? (latest?.versionDate ? Number(latest.versionDate.slice(0, 4)) : null);
    const suggested: CatalogSuggestedFields = {
      title: map.name,
      description: map.description ?? "",
      clubName: club?.name ?? "",
      maker: map.maker ?? latest?.maker ?? "",
      scale: geo.scale,
      norm: geo.norm,
      mapYear: Number.isFinite(mapYear) ? mapYear : null,
      municipalityCodes: geo.municipalityCodes,
      countyCodes: geo.countyCodes,
      bounds: geo.bounds,
      footprint: geo.footprint,
      latestVersionId: latest?.id ?? null
    };
    return { status: "ok", listing: existing ? toDetail(existing) : null, suggested } as const;
  });
}

/** Publicerar eller uppdaterar en klubbkarta i den publika kartbanken (kräver klubb-ADMIN/OWNER). */
export async function upsertClubMapCatalogListing(
  db: Database,
  input: ClubProof & { clubId: string; mapId: string; request: unknown },
  now = new Date(),
  options: { readonly createCanvas?: ServerCanvasFactory } = {}
): Promise<ClubFailure | { status: "quota"; quota: MapQuotaExceeded } | { status: "ok"; listing: PublicMapListingDetail }> {
  const prep = await db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "ADMIN", now, true);
    if (member.status !== "ok") return member;
    if (!validId(input.mapId)) return { status: "invalid-request" } as const;
    const parsed = upsertPublicMapListingInputSchema.safeParse(input.request);
    if (!parsed.success) return { status: "invalid-request" } as const;
    const [map] = await tx.select().from(schema.clubMaps)
      .where(and(eq(schema.clubMaps.id, input.mapId), eq(schema.clubMaps.clubId, input.clubId)));
    if (!map) return { status: "not-found" } as const;
    const versionQuery = parsed.data.clubMapVersionId
      ? and(eq(schema.clubMapVersions.id, parsed.data.clubMapVersionId), eq(schema.clubMapVersions.mapId, map.id), eq(schema.clubMapVersions.clubId, input.clubId))
      : and(eq(schema.clubMapVersions.mapId, map.id), eq(schema.clubMapVersions.clubId, input.clubId));
    const [version] = await tx.select().from(schema.clubMapVersions).where(versionQuery)
      .orderBy(desc(schema.clubMapVersions.versionDate), desc(schema.clubMapVersions.uploadedAt)).limit(1);
    if (!version) return { status: "not-found" } as const;
    const [club] = await tx.select({ name: schema.clubs.name }).from(schema.clubs).where(eq(schema.clubs.id, input.clubId));
    const [existing] = await tx.select().from(schema.publicMapListings).where(eq(schema.publicMapListings.clubMapId, map.id)).limit(1);
    const geo = await versionGeoSuggestion(tx, version);
    return { status: "ok", member, data: parsed.data, map, version, clubName: club?.name ?? "", existing: existing ?? null, geo } as const;
  });
  if (prep.status !== "ok") return prep;

  const { member, data, map, version, existing, geo } = prep;
  let bounds = data.bounds ?? geo.bounds;
  let footprint = data.footprint ?? geo.footprint;
  let scale = data.scale ?? geo.scale;
  let norm: PublicMapNorm = data.norm ?? geo.norm;
  let previewPng: Uint8Array | null = null;
  let previewSha256: string | null =
    version.previewContentSha256 ?? (existing?.contentSha256 === version.contentSha256 ? existing.previewContentSha256 : null);

  const needsPreview = (data.showPreview || data.accessMode === "USE_IN_OTID_LOCKED") && !previewSha256;
  const needsGeoParse = !bounds || scale === null;

  if (needsPreview) {
    try {
      const rendered = await renderMapContentToPng(db, version.contentSha256, version.fileName,
        { mode: "preview", createCanvas: options.createCanvas });
      if (rendered) {
        previewPng = rendered.rendered.png;
        if (!bounds) bounds = rendered.meta.wgs84Bounds;
        if (!footprint) footprint = rendered.meta.footprint;
        if (scale === null) scale = rendered.meta.scale;
        if (data.norm === "OTHER" && rendered.meta.norm !== "OTHER") norm = rendered.meta.norm;
      }
    } catch {
      // Källfilen kunde inte ritas; fortsätt utan förhandsvisning.
    }
  } else if (needsGeoParse) {
    try {
      const bytes = await readMapContent(db, version.contentSha256);
      if (bytes) {
        const meta = extractMapMetadata(new Uint8Array(bytes), version.fileName);
        if (!bounds) bounds = meta.wgs84Bounds;
        if (!footprint) footprint = meta.footprint;
        if (scale === null) scale = meta.scale;
        if (data.norm === "OTHER" && meta.norm !== "OTHER") norm = meta.norm;
      }
    } catch {
      // Källfilen kunde inte tolkas; behåll angivna fält.
    }
  }

  const municipalityCodes = data.municipalityCodes && data.municipalityCodes.length > 0
    ? [...new Set(data.municipalityCodes)]
    : (bounds ? municipalitiesForBounds(bounds) : []);
  const countyCodes = data.countyCodes && data.countyCodes.length > 0
    ? [...new Set(data.countyCodes)]
    : countiesForMunicipalities(municipalityCodes);

  return db.transaction(async tx => {
    if (previewPng) {
      const stored = await storeMapContent(tx, previewPng, member.accountId, now, mapStorageQuota(), { clubId: input.clubId });
      if (stored.status === "quota") return { status: "quota", quota: stored.quota } as const;
      previewSha256 = stored.sha256;
    }
    // Cacha geodata & förhandsvisning på versionen för framtida läsningar.
    await tx.update(schema.clubMapVersions).set({
      ...(bounds ? { minLon: bounds.minLon, maxLon: bounds.maxLon, minLat: bounds.minLat, maxLat: bounds.maxLat } : {}),
      ...(footprint ? { footprint } : {}),
      ...(scale !== null ? { scale } : {}),
      ...(norm ? { norm } : {}),
      ...(previewSha256 ? { previewContentSha256: previewSha256 } : {})
    }).where(eq(schema.clubMapVersions.id, version.id));

    const values = {
      ownerAccountId: member.accountId,
      clubId: input.clubId,
      clubMapId: map.id,
      clubMapVersionId: version.id,
      mapProjectId: null,
      contentSha256: version.contentSha256,
      previewContentSha256: previewSha256,
      format: version.format,
      accessMode: data.accessMode,
      showPreview: data.showPreview,
      title: data.title,
      description: data.description,
      clubName: data.clubName || prep.clubName,
      maker: data.maker,
      scale,
      norm,
      mapYear: data.mapYear ?? null,
      licenseNote: data.licenseNote,
      contact: data.contact,
      municipalityCodes,
      countyCodes,
      minLon: bounds?.minLon ?? null,
      maxLon: bounds?.maxLon ?? null,
      minLat: bounds?.minLat ?? null,
      maxLat: bounds?.maxLat ?? null,
      footprint: footprint ?? null,
      updatedAt: now
    };
    let saved: ListingRow;
    if (existing) {
      const [row] = await tx.update(schema.publicMapListings).set(values)
        .where(eq(schema.publicMapListings.id, existing.id)).returning();
      saved = row!;
    } else {
      const [row] = await tx.insert(schema.publicMapListings).values({ ...values, publishedAt: now }).returning();
      saved = row!;
    }
    await clubJournal(tx, {
      clubId: input.clubId, action: "CLUB_MAP_CATALOG_UPSERTED", actorAccountId: member.accountId,
      details: { mapId: map.id, listingId: saved.id, accessMode: saved.accessMode, showPreview: saved.showPreview }, now
    });
    return { status: "ok", listing: toDetail(saved) } as const;
  });
}

/** Avpublicerar en klubbkarta från den publika kartbanken (idempotent; kräver klubb-ADMIN/OWNER). */
export async function removeClubMapCatalogListing(db: Database, input: ClubProof & { clubId: string; mapId: string }, now = new Date())
  : Promise<ClubFailure | { status: "removed" }> {
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "ADMIN", now, true);
    if (member.status !== "ok") return member;
    if (!validId(input.mapId)) return { status: "not-found" } as const;
    const removed = await tx.delete(schema.publicMapListings)
      .where(and(eq(schema.publicMapListings.clubId, input.clubId), eq(schema.publicMapListings.clubMapId, input.mapId)))
      .returning({ id: schema.publicMapListings.id });
    if (removed.length > 0) {
      await clubJournal(tx, {
        clubId: input.clubId, action: "CLUB_MAP_CATALOG_REMOVED", actorAccountId: member.accountId,
        details: { mapId: input.mapId, listingId: removed[0]!.id }, now
      });
    }
    return { status: "removed" } as const;
  });
}

/** Läser publiceringsstatus och förifyllda värden för ett kartprojekt (kräver projekt-OWNER eller klubb-ADMIN). */
export async function readMapProjectCatalogStatus(db: Database, input: ClubProof & { projectId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; listing: PublicMapListingDetail | null; suggested: CatalogSuggestedFields }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "manage", false);
    if (access.status !== "ok") return access;
    const { project } = access;
    const [existing] = await tx.select().from(schema.publicMapListings)
      .where(eq(schema.publicMapListings.mapProjectId, project.id)).limit(1);
    const clubName = project.clubId
      ? ((await tx.select({ name: schema.clubs.name }).from(schema.clubs).where(eq(schema.clubs.id, project.clubId)))[0]?.name ?? "")
      : "";
    const bounds: PublicMapBounds | null =
      existing && existing.minLon !== null && existing.maxLon !== null && existing.minLat !== null && existing.maxLat !== null
        ? { minLon: existing.minLon, maxLon: existing.maxLon, minLat: existing.minLat, maxLat: existing.maxLat }
        : null;
    const suggested: CatalogSuggestedFields = {
      title: project.name,
      description: existing?.description ?? "",
      clubName,
      maker: existing?.maker ?? "",
      scale: existing?.scale ?? null,
      norm: existing?.norm ?? "OTHER",
      mapYear: existing?.mapYear ?? now.getUTCFullYear(),
      municipalityCodes: existing ? [...existing.municipalityCodes] : [],
      countyCodes: existing ? [...existing.countyCodes] : [],
      bounds,
      footprint: existing?.footprint ?? null
    };
    return { status: "ok", listing: existing ? toDetail(existing) : null, suggested } as const;
  });
}

/** Publicerar eller uppdaterar ett kartprojekt i den publika kartbanken (enskilda kartritare med eller utan klubb). */
export async function upsertMapProjectCatalogListing(
  db: Database,
  input: ClubProof & { projectId: string; request: unknown },
  now = new Date(),
  options: { readonly createCanvas?: ServerCanvasFactory } = {}
): Promise<ClubFailure | { status: "quota"; quota: MapQuotaExceeded } | { status: "ok"; listing: PublicMapListingDetail }> {
  const prep = await db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "manage", true);
    if (access.status !== "ok") return access;
    if (!await mapProjectCanDownloadSource(tx, access.accountId, access.role, access.project)) return { status: "forbidden" } as const;
    const parsed = upsertPublicMapListingInputSchema.safeParse(input.request);
    if (!parsed.success) return { status: "invalid-request" } as const;
    const { project, accountId } = access;
    const fileName = (await mapProjectBaseFileName(tx, project)) ?? (project.baseFormat === "OCD" ? "karta.ocd" : "karta.omap");
    const clubName = project.clubId
      ? ((await tx.select({ name: schema.clubs.name }).from(schema.clubs).where(eq(schema.clubs.id, project.clubId)))[0]?.name ?? "")
      : "";
    const [existing] = await tx.select().from(schema.publicMapListings)
      .where(eq(schema.publicMapListings.mapProjectId, project.id)).limit(1);
    return { status: "ok", accountId, project, fileName, clubName, data: parsed.data, existing: existing ?? null } as const;
  });
  if (prep.status !== "ok") return prep;

  const { accountId, project, fileName, data, existing } = prep;
  let bounds = data.bounds ?? (existing && existing.minLon !== null && existing.maxLon !== null && existing.minLat !== null && existing.maxLat !== null
    ? { minLon: existing.minLon, maxLon: existing.maxLon, minLat: existing.minLat, maxLat: existing.maxLat } : null);
  let footprint = data.footprint ?? existing?.footprint ?? null;
  let scale = data.scale ?? existing?.scale ?? null;
  let norm: PublicMapNorm = data.norm ?? existing?.norm ?? "OTHER";
  let previewPng: Uint8Array | null = null;
  let previewSha256: string | null = existing?.contentSha256 === project.baseSha256 ? existing.previewContentSha256 : null;

  const needsPreview = (data.showPreview || data.accessMode === "USE_IN_OTID_LOCKED") && !previewSha256;
  const needsGeoParse = !bounds || scale === null;

  if (needsPreview) {
    try {
      const rendered = await renderMapContentToPng(db, project.baseSha256, fileName,
        { mode: "preview", createCanvas: options.createCanvas });
      if (rendered) {
        previewPng = rendered.rendered.png;
        if (!bounds) bounds = rendered.meta.wgs84Bounds;
        if (!footprint) footprint = rendered.meta.footprint;
        if (scale === null) scale = rendered.meta.scale;
        if (data.norm === "OTHER" && rendered.meta.norm !== "OTHER") norm = rendered.meta.norm;
      }
    } catch {
      // Fortsätt utan förhandsvisning om källfilen inte gick att rita.
    }
  } else if (needsGeoParse) {
    try {
      const bytes = await readMapContent(db, project.baseSha256);
      if (bytes) {
        const meta = extractMapMetadata(new Uint8Array(bytes), fileName);
        if (!bounds) bounds = meta.wgs84Bounds;
        if (!footprint) footprint = meta.footprint;
        if (scale === null) scale = meta.scale;
        if (data.norm === "OTHER" && meta.norm !== "OTHER") norm = meta.norm;
      }
    } catch {
      // Behåll angivna fält.
    }
  }

  const municipalityCodes = data.municipalityCodes && data.municipalityCodes.length > 0
    ? [...new Set(data.municipalityCodes)]
    : (bounds ? municipalitiesForBounds(bounds) : []);
  const countyCodes = data.countyCodes && data.countyCodes.length > 0
    ? [...new Set(data.countyCodes)]
    : countiesForMunicipalities(municipalityCodes);

  return db.transaction(async tx => {
    if (previewPng) {
      const stored = await storeMapContent(tx, previewPng, accountId, now, mapStorageQuota(),
        project.clubId ? { clubId: project.clubId } : undefined);
      if (stored.status === "quota") return { status: "quota", quota: stored.quota } as const;
      previewSha256 = stored.sha256;
    }
    const values = {
      ownerAccountId: accountId,
      clubId: project.clubId,
      clubMapId: null,
      clubMapVersionId: null,
      mapProjectId: project.id,
      contentSha256: project.baseSha256,
      previewContentSha256: previewSha256,
      format: project.baseFormat,
      accessMode: data.accessMode,
      showPreview: data.showPreview,
      title: data.title,
      description: data.description,
      clubName: data.clubName || prep.clubName,
      maker: data.maker,
      scale,
      norm,
      mapYear: data.mapYear ?? null,
      licenseNote: data.licenseNote,
      contact: data.contact,
      municipalityCodes,
      countyCodes,
      minLon: bounds?.minLon ?? null,
      maxLon: bounds?.maxLon ?? null,
      minLat: bounds?.minLat ?? null,
      maxLat: bounds?.maxLat ?? null,
      footprint: footprint ?? null,
      updatedAt: now
    };
    let saved: ListingRow;
    if (existing) {
      const [row] = await tx.update(schema.publicMapListings).set(values)
        .where(eq(schema.publicMapListings.id, existing.id)).returning();
      saved = row!;
    } else {
      const [row] = await tx.insert(schema.publicMapListings).values({ ...values, publishedAt: now }).returning();
      saved = row!;
    }
    await mapProjectJournal(tx, project, {
      action: "MAP_PROJECT_CATALOG_UPSERTED", actorAccountId: accountId,
      details: { projectId: project.id, listingId: saved.id, accessMode: saved.accessMode, showPreview: saved.showPreview }, now
    });
    return { status: "ok", listing: toDetail(saved) } as const;
  });
}

/** Avpublicerar ett kartprojekt från den publika kartbanken (idempotent; kräver projekt-OWNER eller klubb-ADMIN). */
export async function removeMapProjectCatalogListing(db: Database, input: ClubProof & { projectId: string }, now = new Date())
  : Promise<ClubFailure | { status: "removed" }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "manage", true);
    if (access.status !== "ok") return access;
    const removed = await tx.delete(schema.publicMapListings)
      .where(eq(schema.publicMapListings.mapProjectId, access.project.id))
      .returning({ id: schema.publicMapListings.id });
    if (removed.length > 0) {
      await mapProjectJournal(tx, access.project, {
        action: "MAP_PROJECT_CATALOG_REMOVED", actorAccountId: access.accountId,
        details: { projectId: access.project.id, listingId: removed[0]!.id }, now
      });
    }
    return { status: "removed" } as const;
  });
}

export type UsePublicMapListingResult =
  | ClubFailure
  | { status: "problem"; problem: RaceMapProblem; quota?: MapQuotaExceeded }
  | { status: "created"; eventId: string; raceId: string; georeferenced: boolean; sourceDownloadLocked: boolean };

/**
 * "Använd i ny träning" från `/kartbank`: skapar en ny träning för den inloggade användaren,
 * kopplar `race_map_source` med `publicListingId` och `sourceDownloadLocked = (accessMode === "USE_IN_OTID_LOCKED")`,
 * samt sparar serverrenderad högupplöst `race_map` PNG (rå `.ocd`/`.omap` lämnar aldrig servern).
 */
export async function createRaceFromPublicMapListing(
  db: Database,
  input: ClubProof & { listingId: string; request?: unknown },
  now = new Date(),
  options: { readonly createCanvas?: ServerCanvasFactory } = {}
): Promise<UsePublicMapListingResult> {
  const prep = await db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    if (!validId(input.listingId)) return { status: "not-found" } as const;
    const parsed = usePublicMapListingRequestSchema.safeParse(input.request ?? {});
    if (!parsed.success) return { status: "invalid-request" } as const;
    const [listing] = await tx.select().from(schema.publicMapListings)
      .where(eq(schema.publicMapListings.id, input.listingId)).limit(1);
    if (!listing) return { status: "not-found" } as const;
    if (listing.accessMode !== "USE_IN_OTID_LOCKED" && listing.accessMode !== "OPEN_DOWNLOAD") {
      return { status: "forbidden" } as const;
    }
    const [content] = await tx.select({ byteLength: schema.mapContents.byteLength }).from(schema.mapContents)
      .where(eq(schema.mapContents.sha256, listing.contentSha256)).limit(1);
    if (!content) return { status: "not-found" } as const;
    return { status: "ok", accountId: auth.principal.accountId, listing, byteLength: content.byteLength, data: parsed.data } as const;
  });
  if (prep.status !== "ok") return prep;

  const { accountId, listing, byteLength, data } = prep;
  const fileName = safeDownloadFileName(listing.title, listing.format);
  let rendered;
  try {
    rendered = await renderMapContentToPng(db, listing.contentSha256, fileName,
      { mode: "race", createCanvas: options.createCanvas });
  } catch {
    return { status: "problem", problem: "INVALID_MAP_FILE" };
  }
  if (!rendered) return { status: "not-found" };

  let transform: { a: number; b: number; c: number; d: number; e: number; f: number } | null = null;
  if (rendered.rendered.tiePoints) {
    try {
      transform = {
        ...deriveRasterGeoreference({
          imageWidth: rendered.rendered.width,
          imageHeight: rendered.rendered.height,
          tiePoints: rendered.rendered.tiePoints
        }).transform
      };
    } catch (error) {
      if (!(error instanceof RasterGeoreferenceError)) throw error;
    }
  }

  const eventName = (data.name ?? listing.title).slice(0, 200);
  const raceDate = data.raceDate ?? swedishToday(now);
  const sourceDownloadLocked = listing.accessMode === "USE_IN_OTID_LOCKED";

  return db.transaction(async tx => {
    const storedImage = await storeMapContent(tx, rendered.rendered.png, accountId, now, mapStorageQuota());
    if (storedImage.status === "quota") {
      return { status: "problem", problem: "STORAGE_QUOTA_EXCEEDED" as const, quota: storedImage.quota } as const;
    }
    const { event, race } = await insertEventWithRace(tx, {
      eventName,
      raceName: "",
      raceDate,
      timeZone: "Europe/Stockholm",
      raceType: "TRAINING",
      firstStartTime: null,
      trainingGroupId: null,
      ownerAccountId: accountId,
      now
    });
    const pngFileName = `${fileName.replace(/\.[^.]{1,8}$/, "")}.png`.slice(0, 200);
    await tx.insert(schema.raceMaps).values({
      raceId: race.id,
      fileName: pngFileName,
      mediaType: "image/png",
      image: null,
      contentSha256: storedImage.sha256,
      sha256: storedImage.sha256,
      byteLength: rendered.rendered.png.byteLength,
      width: rendered.rendered.width,
      height: rendered.rendered.height,
      tiePoints: rendered.rendered.tiePoints ? [...rendered.rendered.tiePoints] : null,
      transform,
      uploadedAt: now,
      georeferencedAt: transform ? now : null
    });
    await tx.insert(schema.raceMapSources).values({
      raceId: race.id,
      fileName,
      format: listing.format,
      version: rendered.sourceMetadata.version,
      file: null,
      contentSha256: listing.contentSha256,
      sha256: listing.contentSha256,
      byteLength,
      scale: rendered.sourceMetadata.scale,
      bounds: rendered.sourceMetadata.bounds,
      georeference: rendered.sourceMetadata.georeference,
      render: rendered.sourceMetadata.render,
      summary: rendered.sourceMetadata.summary,
      uploadedAt: now,
      clubMapId: listing.clubMapId,
      clubMapVersionId: listing.clubMapVersionId,
      publicListingId: listing.id,
      sourceDownloadLocked,
      usageScope: "ANY"
    });
    await tx.insert(schema.auditEvents).values({
      raceId: race.id,
      entityType: "race_map",
      entityId: race.id,
      action: "RACE_CREATED_FROM_PUBLIC_MAP",
      actorKind: "USER_ACCOUNT",
      actorId: accountId,
      after: { publicListingId: listing.id, sourceDownloadLocked, georeferenced: transform !== null },
      createdAt: now
    });
    return { status: "created", eventId: event.id, raceId: race.id, georeferenced: transform !== null, sourceDownloadLocked } as const;
  });
}
