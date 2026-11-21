import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lte, or, type SQL } from "drizzle-orm";
import { NEWS_IMAGE_MAX_BYTES, newsListSchema, newsSaveRequestSchema, type NewsItem, type NewsList, type NewsSaveRequest } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { canWriteClubNews, homeNews, HOME_NEWS_LIMIT, normalizedNewsLink } from "@o-tid/domain";
import { clubMembership, clubJournal, requireClubRole, type ClubFailure, type ClubProof } from "./club-access";
import { derivedClubIds } from "./club-affiliation-access";
import { imageDimensions, webpDimensions } from "./image-dimensions";
import { UUID_PATTERN } from "./serialization";
import { requireSuperadmin } from "./superadmin";
import type { DbExecutor } from "./snapshot";
import { authenticateUserAccountSessionForProtectedRead, type UserAccountSessionProof } from "./user-account";

/**
 * ADR-0230: nyhetsflödet «Nytt i O-Tid». Allmänna nyheter skriver superadmin (på /superadmin); en klubbs nyheter skriver
 * klubbens ledare, administratörer och ägare (på klubbytan). Allmänna syns för alla på startsidan, en klubbs bara för klubbens
 * inloggade medlemmar (startsidan och klubbytan). Superadmin kan ändra, dölja och ta bort alla nyheter (moderering).
 * Behörigheten prövas här med samma funktioner som resten av appen (`requireSuperadmin`, `requireClubRole`, `clubMembership`).
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type NewsFailure = ClubFailure;
type Saved = NewsFailure | { status: "saved"; item: NewsItem; created: boolean };

const news = schema.newsItems;
const LIST_LIMIT = 200;

const columns = {
  id: news.id, clubId: news.clubId, clubName: schema.clubs.name, title: news.title, body: news.body, link: news.link,
  imageSha256: news.imageSha256, imageWidth: news.imageWidth, imageHeight: news.imageHeight, publishedAt: news.publishedAt,
  hiddenAt: news.hiddenAt, updatedAt: news.updatedAt
};
type Row = { id: string; clubId: string | null; clubName: string | null; title: string; body: string; link: string | null;
  imageSha256: string | null; imageWidth: number | null; imageHeight: number | null; publishedAt: Date; hiddenAt: Date | null; updatedAt: Date };

/** Bildens adress: versionen (början av SHA-256) gör att webbläsaren får spara den länge. */
export const newsImagePath = (newsId: string, sha256: string) => `/api/public/news/${newsId}/image?v=${sha256.slice(0, 16)}`;

function dto(row: Row): NewsItem {
  return { newsId: row.id, clubId: row.clubId, clubName: row.clubName, title: row.title, body: row.body, link: row.link,
    imageUrl: row.imageSha256 ? newsImagePath(row.id, row.imageSha256) : null, imageWidth: row.imageWidth, imageHeight: row.imageHeight,
    publishedAt: row.publishedAt.toISOString(), hidden: row.hiddenAt !== null, updatedAt: row.updatedAt.toISOString() };
}

const select = (tx: DbExecutor, where: SQL | undefined, limit: number) => tx.select(columns).from(news)
  .leftJoin(schema.clubs, eq(schema.clubs.id, news.clubId)).where(where).orderBy(desc(news.publishedAt), desc(news.id)).limit(limit);

/**
 * Klubbarna där kontot är medlem: raderna i `club_member` som `clubMembership` godtar (bekräftad adress om någon annan lade
 * till kontot) och de bekräftade tillhörigheterna (ADR-0209 beslut 3). Inbjudningar tas inte här (det gör klubbytan).
 */
async function memberClubIds(tx: DbExecutor, accountId: string): Promise<Set<string>> {
  const explicit = await tx.select({ clubId: schema.clubMembers.clubId }).from(schema.clubMembers).where(eq(schema.clubMembers.accountId, accountId)).limit(200);
  const ids = new Set<string>();
  for (const { clubId } of explicit) if (await clubMembership(tx, { accountId, clubId }, "none")) ids.add(clubId);
  for (const clubId of await derivedClubIds(tx, accountId)) ids.add(clubId);
  return ids;
}

/**
 * Startsidans spalt: allmänna nyheter för alla, klubbens för dess inloggade medlemmar, nyast först, högst tre, och inget
 * när den senaste är äldre än cirka 60 dagar (`homeNews`). En ogiltig eller utgången session ger samma svar som utloggad.
 */
export async function listHomeNews(db: Database, sessionToken: string | null, now = new Date()): Promise<NewsItem[]> {
  return db.transaction(async tx => {
    let clubIds = new Set<string>();
    if (sessionToken) {
      const auth = await authenticateUserAccountSessionForProtectedRead(tx, { sessionToken }, now);
      if (auth.status === "authenticated") clubIds = await memberClubIds(tx, auth.principal.accountId);
    }
    const audience = clubIds.size > 0 ? or(isNull(news.clubId), inArray(news.clubId, [...clubIds])) : isNull(news.clubId);
    const rows = await select(tx, and(isNull(news.hiddenAt), lte(news.publishedAt, now), audience), HOME_NEWS_LIMIT);
    return homeNews(rows.map(row => ({ ...row, hidden: false })), clubIds, now).map(dto);
  });
}

type Image = { bytes: Buffer; mediaType: "image/webp" | "image/jpeg" | "image/png"; width: number; height: number; sha256: string };

/** Bilden ur anropet: rätt typ enligt filens egna bytes, de angivna måtten och högst `NEWS_IMAGE_MAX_BYTES`. */
function decodeImage(image: NonNullable<NewsSaveRequest["image"]>): Image | undefined {
  const bytes = Buffer.from(image.base64, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > NEWS_IMAGE_MAX_BYTES) return undefined;
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found = image.mediaType === "image/webp" ? webpDimensions(view) : imageDimensions(view);
  if (!found || found.mediaType !== image.mediaType || found.width !== image.width || found.height !== image.height) return undefined;
  return { bytes, mediaType: image.mediaType, width: image.width, height: image.height, sha256: createHash("sha256").update(bytes).digest("hex") };
}

type Parsed = { request: NewsSaveRequest; link: string | null; image: Image | null | undefined };
function parse(body: unknown): Parsed | undefined {
  const parsed = newsSaveRequestSchema.safeParse(body);
  if (!parsed.success) return undefined;
  const link = parsed.data.link === "" ? null : normalizedNewsLink(parsed.data.link) ?? undefined;
  if (link === undefined) return undefined;
  const image = parsed.data.image === undefined ? undefined : parsed.data.image === null ? null : decodeImage(parsed.data.image);
  if (image === undefined && parsed.data.image) return undefined;
  return { request: parsed.data, link, image };
}

const imageColumns = (image: Image | null) => image
  ? { image: image.bytes, imageMediaType: image.mediaType, imageWidth: image.width, imageHeight: image.height, imageSha256: image.sha256 }
  : { image: null, imageMediaType: null, imageWidth: null, imageHeight: null, imageSha256: null };

/**
 * Ny nyhet (utan `newsId`, idempotent på `requestId`) eller ändrad. `scope` är området som behörigheten redan prövats för:
 * superadmin (`ANY`: ny = allmän, ändra = alla) eller en klubb (bara klubbens egna).
 */
async function save(tx: Transaction, input: { scope: "ANY" | { clubId: string }; accountId: string; newsId?: string | undefined; parsed: Parsed;
  now: Date }): Promise<Saved> {
  const { request, link, image } = input.parsed;
  const clubId = input.scope === "ANY" ? null : input.scope.clubId;
  const fields = { title: request.title, body: request.body, link, updatedBy: input.accountId, updatedAt: input.now,
    ...(image !== undefined ? imageColumns(image) : {}) };
  if (!input.newsId) {
    const [replay] = await tx.select({ id: news.id, clubId: news.clubId, createdBy: news.createdBy }).from(news).where(eq(news.requestId, request.requestId));
    if (replay) {
      if (replay.clubId !== clubId || replay.createdBy !== input.accountId) return { status: "conflict" };
      return { status: "saved", item: dto((await select(tx, eq(news.id, replay.id), 1))[0]!), created: false };
    }
    const id = randomUUID();
    await tx.insert(news).values({ id, requestId: request.requestId, clubId, ...imageColumns(null), ...fields, publishedAt: input.now,
      hiddenAt: request.hidden ? input.now : null, createdBy: input.accountId, createdAt: input.now }).onConflictDoNothing();
    const [created] = await select(tx, eq(news.id, id), 1);
    if (!created) return { status: "conflict" };
    if (clubId) await clubJournal(tx, { clubId, action: "NEWS_CREATED", actorAccountId: input.accountId, details: { newsId: id }, now: input.now });
    return { status: "saved", item: dto(created), created: true };
  }
  const [existing] = await tx.select({ clubId: news.clubId, hiddenAt: news.hiddenAt }).from(news).where(eq(news.id, input.newsId)).for("update");
  if (!existing || (clubId !== null && existing.clubId !== clubId)) return { status: "not-found" };
  const hiddenAt = request.hidden === undefined ? existing.hiddenAt : request.hidden ? existing.hiddenAt ?? input.now : null;
  await tx.update(news).set({ ...fields, hiddenAt }).where(eq(news.id, input.newsId));
  if (existing.clubId) await clubJournal(tx, { clubId: existing.clubId, action: "NEWS_UPDATED", actorAccountId: input.accountId,
    details: { newsId: input.newsId, hidden: hiddenAt !== null, ...(input.scope === "ANY" ? { superadmin: true } : {}) }, now: input.now });
  return { status: "saved", item: dto((await select(tx, eq(news.id, input.newsId), 1))[0]!), created: false };
}

async function remove(tx: Transaction, input: { scope: "ANY" | { clubId: string }; accountId: string; newsId: string; now: Date })
  : Promise<NewsFailure | { status: "removed" }> {
  const [existing] = await tx.select({ clubId: news.clubId }).from(news).where(eq(news.id, input.newsId)).for("update");
  if (!existing || (input.scope !== "ANY" && existing.clubId !== input.scope.clubId)) return { status: "not-found" };
  await tx.delete(news).where(eq(news.id, input.newsId));
  if (existing.clubId) await clubJournal(tx, { clubId: existing.clubId, action: "NEWS_DELETED", actorAccountId: input.accountId,
    details: { newsId: input.newsId, ...(input.scope === "ANY" ? { superadmin: true } : {}) }, now: input.now });
  return { status: "removed" };
}

const validNewsId = (newsId: string | undefined) => newsId === undefined || UUID_PATTERN.test(newsId);

// --- Superadmin ------------------------------------------------------------------------------------------------------------

/** Alla nyheter, allmänna och klubbarnas, också dolda (moderering). */
export async function listNewsAsSuperadmin(db: Database, proof: UserAccountSessionProof, now = new Date())
  : Promise<NewsFailure | { status: "ok"; response: NewsList }> {
  return db.transaction(async tx => {
    const auth = await requireSuperadmin(tx, proof, now, "read");
    if (auth.status !== "authenticated") return auth;
    return { status: "ok", response: newsListSchema.parse({ formatVersion: 1, canWrite: true, items: (await select(tx, undefined, LIST_LIMIT)).map(dto) }) };
  });
}

export async function saveNewsAsSuperadmin(db: Database, input: UserAccountSessionProof & { newsId?: string; request: unknown }, now = new Date()): Promise<Saved> {
  if (!validNewsId(input.newsId)) return { status: "not-found" };
  return db.transaction(async tx => {
    const auth = await requireSuperadmin(tx, input, now, "mutation");
    if (auth.status !== "authenticated") return auth;
    const parsed = parse(input.request);
    if (!parsed) return { status: "invalid-request" };
    return save(tx, { scope: "ANY", accountId: auth.principal.accountId, newsId: input.newsId, parsed, now });
  });
}

export async function deleteNewsAsSuperadmin(db: Database, input: UserAccountSessionProof & { newsId: string }, now = new Date())
  : Promise<NewsFailure | { status: "removed" }> {
  if (!UUID_PATTERN.test(input.newsId)) return { status: "not-found" };
  return db.transaction(async tx => {
    const auth = await requireSuperadmin(tx, input, now, "mutation");
    if (auth.status !== "authenticated") return auth;
    return remove(tx, { scope: "ANY", accountId: auth.principal.accountId, newsId: input.newsId, now });
  });
}

// --- Klubben ---------------------------------------------------------------------------------------------------------------

/** Klubbens nyheter: medlemmen ser de synliga, den som skriver (ledare och uppåt) också de dolda. */
export async function listClubNews(db: Database, input: ClubProof & { clubId: string }, now = new Date())
  : Promise<NewsFailure | { status: "ok"; response: NewsList }> {
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "READER", now, false);
    if (member.status !== "ok") return member;
    const canWrite = canWriteClubNews(member.role);
    const rows = await select(tx, and(eq(news.clubId, input.clubId), canWrite ? undefined : and(isNull(news.hiddenAt), lte(news.publishedAt, now))), LIST_LIMIT);
    return { status: "ok", response: newsListSchema.parse({ formatVersion: 1, canWrite, items: rows.map(dto) }) };
  });
}

export async function saveClubNews(db: Database, input: ClubProof & { clubId: string; newsId?: string; request: unknown }, now = new Date()): Promise<Saved> {
  if (!validNewsId(input.newsId)) return { status: "not-found" };
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "LEADER", now, true);
    if (member.status !== "ok") return member;
    const parsed = parse(input.request);
    if (!parsed) return { status: "invalid-request" };
    return save(tx, { scope: { clubId: input.clubId }, accountId: member.accountId, newsId: input.newsId, parsed, now });
  });
}

export async function deleteClubNews(db: Database, input: ClubProof & { clubId: string; newsId: string }, now = new Date())
  : Promise<NewsFailure | { status: "removed" }> {
  if (!UUID_PATTERN.test(input.newsId)) return { status: "not-found" };
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "LEADER", now, true);
    if (member.status !== "ok") return member;
    return remove(tx, { scope: { clubId: input.clubId }, accountId: member.accountId, newsId: input.newsId, now });
  });
}

// --- Bilden ----------------------------------------------------------------------------------------------------------------

/**
 * En nyhets bild för den som får se nyheten: en synlig allmän nyhet för alla (`shared`: får sparas i en delad cache), en synlig
 * klubbnyhet för klubbens medlemmar, en dold eller kommande bara för den som skriver (superadmin, klubbens ledare och uppåt).
 */
export async function readNewsImage(db: Database, newsId: string, sessionToken: string | null, now = new Date())
  : Promise<{ image: Buffer; mediaType: string; sha256: string; shared: boolean } | undefined> {
  if (!UUID_PATTERN.test(newsId)) return undefined;
  return db.transaction(async tx => {
    const [row] = await tx.select({ clubId: news.clubId, image: news.image, mediaType: news.imageMediaType, sha256: news.imageSha256,
      hiddenAt: news.hiddenAt, publishedAt: news.publishedAt }).from(news).where(eq(news.id, newsId));
    if (!row?.image || !row.mediaType || !row.sha256) return undefined;
    const image = { image: row.image, mediaType: row.mediaType, sha256: row.sha256 };
    const open = row.hiddenAt === null && row.publishedAt <= now;
    if (open && row.clubId === null) return { ...image, shared: true };
    if (!sessionToken) return undefined;
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, { sessionToken }, now);
    if (auth.status !== "authenticated") return undefined;
    if (auth.principal.superadmin) return { ...image, shared: false };
    if (row.clubId === null) return undefined;
    const member = await clubMembership(tx, { accountId: auth.principal.accountId, clubId: row.clubId }, "none");
    if (!member || (!open && !canWriteClubNews(member.role))) return undefined;
    return { ...image, shared: false };
  });
}
