import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  CLUB_ARCHIVE_COURSE_FILE_MAX_BYTES, raceClubArchiveAutoRequestSchema, raceClubArchiveLiftRequestSchema, raceOrganiserRequestSchema,
  type RaceClubArchiveView
} from "@o-tid/contracts";
import { writeIofCourseData, writePpen, type CourseSettingDocument } from "@o-tid/course-setting";
import { schema, type Database } from "@o-tid/database";
import { localRaceDate, raceFinishedForArchive, raceTitle } from "@o-tid/domain";
import { clubJournal, clubMembership, clubRoleAtLeast } from "./club-access";
import { forgetEntryThumbnail } from "./club-archive-checks";
import { courseFileSummary } from "./club-archive-import";
import { forgetArchivePeople, snapshotPlanPeople } from "./club-plan-people";
import { autoArchiveRow, autoArchiveView, markAutoArchived, setAutoArchive } from "./race-club-archive-auto-state";
import { coursesArePublic } from "./course-secrecy";
import { organisationById, organisationSummary } from "./organisations";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0209 beslut 4: tävlingens arrangörsklubb och tävlingen i klubbarkivet.
 *
 * - Arrangörsklubben är en klubb i listan; förvalet är skaparens bekräftade klubb. Den syns bara för tävlingens behöriga.
 * - Före tävlingen visas ingenting om den för klubben. "Lägg i klubbarkivet" gör en träning i klubbarkivet som är kopplat
 *   till arrangörsklubben, med tävlingens kartfil (som kartversion i klubbens kartor, ADR-0196; samma innehåll en gång),
 *   banläggningens dokument (.ppen), banorna som IOF XML och en länk tillbaka till tävlingen. Inga personuppgifter: inga
 *   startlistor, resultat eller deltagare. Bara den som är administratör både i tävlingen och i klubbarkivet får göra det.
 * - Före tävlingsdagen (eller medan banorna är hemliga, ADR-0176) krävs att arrangören bekräftar banhemligheten.
 * - "Ta ur klubbarkivet" tar bort träningen (och kartan och versionen som inlyftet skapade, om inget annat använder dem).
 *   Tävlingen ändras aldrig.
 * - Ägaren 2026-11-12 (ADR-0209 tillägg 2026-11-12): "Lägg i klubbarkivet när träningen är klar" (förval på för en Träning)
 *   gör samma inlyft automatiskt med ägarens eller den ansvariges behörighet (`race-club-archive-auto`). Inlyftet sparar planens
 *   personer (G (ii)) och sätter spärren mot en ny automatisk arkivering.
 */
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" };
type ReadProof = Omit<RaceSessionProof, "csrfCookie" | "csrfHeader"> & Partial<Pick<RaceSessionProof, "csrfCookie" | "csrfHeader">>;

export async function raceFacts(tx: DbExecutor, raceId: string) {
  const [row] = await tx.select({ race: schema.races, event: schema.events }).from(schema.races)
    .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId)).where(eq(schema.races.id, raceId));
  return row;
}

/** Den som äger tävlingen (skaparen) och hens bekräftade klubb i listan, för förvalet. */
async function ownerConfirmedOrganisation(tx: DbExecutor, eventId: string): Promise<string | undefined> {
  const rows = (await tx.execute<{ organisation_id: string }>(sql`select m.organisation_id from event_administration_grant g
    join account_club_membership m on m.account_id = g.account_id and m.status = 'CONFIRMED' and m.organisation_id is not null
    where g.event_id = ${eventId} and g.role = 'OWNER' order by m.decided_at limit 2`)).rows;
  return rows[0]?.organisation_id;
}

/** Förvalet när tävlingen skapas: skaparens bekräftade klubb, om hen har precis en. */
export async function defaultRaceOrganiser(tx: DbExecutor, input: { raceId: string; accountId: string; now: Date }): Promise<void> {
  const rows = await tx.select({ organisationId: schema.accountClubMemberships.organisationId }).from(schema.accountClubMemberships)
    .where(and(eq(schema.accountClubMemberships.accountId, input.accountId), eq(schema.accountClubMemberships.status, "CONFIRMED"),
      sql`${schema.accountClubMemberships.organisationId} is not null`)).limit(2);
  if (rows.length !== 1) return;
  await tx.insert(schema.raceOrganisers).values({ raceId: input.raceId, organisationId: rows[0]!.organisationId!, setBy: input.accountId,
    setAt: input.now }).onConflictDoNothing();
}

/** Klubbarkivet som är kopplat till arrangörsklubben och den inloggades roll där (undefined = inget, eller inte medlem). */
async function organiserSpace(tx: DbExecutor, raceId: string, accountId: string) {
  const [organiser] = await tx.select().from(schema.raceOrganisers).where(eq(schema.raceOrganisers.raceId, raceId));
  if (!organiser) return { organiser: undefined, space: undefined };
  const [setting] = await tx.select({ clubId: schema.clubSettings.clubId, name: schema.clubs.name }).from(schema.clubSettings)
    .innerJoin(schema.clubs, eq(schema.clubs.id, schema.clubSettings.clubId))
    .where(eq(schema.clubSettings.organisationId, organiser.organisationId));
  if (!setting) return { organiser, space: undefined };
  const member = await clubMembership(tx, { accountId, clubId: setting.clubId }, "none");
  return { organiser, space: member && clubRoleAtLeast(member.role, "ADMIN") ? { clubId: setting.clubId, name: setting.name } : undefined };
}

export async function liftOf(tx: DbExecutor, raceId: string, clubId: string) {
  const [row] = await tx.select({ lift: schema.raceClubArchives, entryId: schema.clubArchiveEntries.id }).from(schema.raceClubArchives)
    .leftJoin(schema.clubArchiveEntries, eq(schema.clubArchiveEntries.id, schema.raceClubArchives.entryId))
    .where(and(eq(schema.raceClubArchives.raceId, raceId), eq(schema.raceClubArchives.clubId, clubId)));
  return row;
}

async function view(tx: DbExecutor, raceId: string, accountId: string, now: Date): Promise<RaceClubArchiveView | undefined> {
  const facts = await raceFacts(tx, raceId);
  if (!facts) return undefined;
  const { organiser, space } = await organiserSpace(tx, raceId, accountId);
  const organisation = organiser ? await organisationById(tx, organiser.organisationId) : undefined;
  const suggestedId = organiser ? undefined : await ownerConfirmedOrganisation(tx, facts.event.id);
  const suggested = suggestedId ? await organisationById(tx, suggestedId) : undefined;
  const coursesPublic = await coursesArePublic(tx, raceId);
  const lift = space ? await liftOf(tx, raceId, space.clubId) : undefined;
  const [map] = await tx.select({ fileName: schema.raceMapSources.fileName, sha: schema.raceMapSources.contentSha256 }).from(schema.raceMapSources)
    .where(eq(schema.raceMapSources.raceId, raceId));
  const [setting] = await tx.select({ document: schema.courseSettings.document }).from(schema.courseSettings).where(eq(schema.courseSettings.raceId, raceId));
  const courseFile = await latestCourseFile(tx, raceId);
  const withoutMap = setting ? await coursesWithoutMap(tx, raceId, setting.document as unknown as CourseSettingDocument) : [];
  return { formatVersion: 1, raceId, raceDate: facts.race.raceDate, organiser: organisation ? organisationSummary(organisation) : null,
    suggestion: suggested ? organisationSummary(suggested) : null, space: space ? "ADMIN" : "NONE", spaceName: space?.name ?? null,
    finished: raceFinishedForArchive({ raceDate: facts.race.raceDate, today: localRaceDate(now, facts.event.timeZone), coursesPublic }),
    coursesPublic, lifted: lift?.entryId ? { clubId: lift.lift.clubId, entryId: lift.entryId, liftedAt: lift.lift.liftedAt.toISOString() } : null,
    contents: { mapFile: map?.sha ? map.fileName : null, courseSetting: !!setting, courseFile: !!courseFile, coursesWithoutMap: withoutMap },
    auto: space ? autoArchiveView(await autoArchiveRow(tx, raceId), facts.race.raceType) : null };
}

/**
 * Användartestet 2026-11-12 (C): tidtagningens banor som banläggningen inte har (t.ex. skrivna som kontrollkoder i
 * arbetsytan). De har inga lägen på kartan och kommer inte med i .ppen eller i banläggningens IOF XML. Namnen jämförs som
 * Överför till tävlingen döper banorna (en gafflad bana heter som familjen).
 */
async function coursesWithoutMap(tx: DbExecutor, raceId: string, document: CourseSettingDocument): Promise<string[]> {
  const drawn = new Set(document.courses.map(course => course.name.trim().toLocaleLowerCase("sv-SE")));
  const rows = await tx.select({ name: schema.courses.name }).from(schema.courses).where(eq(schema.courses.raceId, raceId));
  return [...new Set(rows.map(row => row.name.trim()).filter(name => name && !drawn.has(name.toLocaleLowerCase("sv-SE"))))]
    .sort((a, b) => a.localeCompare(b, "sv-SE")).slice(0, 50);
}

/** Arkivpostens anteckning om banorna utan lägen (arkivet är på svenska, som träningarnas övriga text). */
function withoutMapNote(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} och ${names[names.length - 1]}`;
  return `${list} har bara kontrollkoder och kan inte visas på kartan. ${names.length === 1 ? "Banan" : "Banorna"} finns i tävlingen men inte i banfilerna här.`;
}

export async function readRaceClubArchiveAsAdmin(db: Database, input: ReadProof, now = new Date())
  : Promise<Failure | { status: "ok"; view: RaceClubArchiveView }> {
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, csrfCookie: input.csrfCookie ?? null, csrfHeader: input.csrfHeader ?? null, role: "ADMIN" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    const result = await view(tx, auth.principal.raceId, auth.principal.accountId, now);
    return result ? { status: "ok", view: result } as const : { status: "not-found" } as const;
  });
}

/** Arrangörsklubben (eller ingen). Bara tävlingens administratörer; auditpost på tävlingen. */
export async function setRaceOrganiserAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date())
  : Promise<Failure | { status: "ok"; view: RaceClubArchiveView }> {
  const parsed = raceOrganiserRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    const { raceId, accountId } = auth.principal;
    const organisationId = parsed.data.organisationId;
    if (organisationId) {
      const organisation = await organisationById(tx, organisationId);
      if (!organisation || organisation.removedAt) return { status: "not-found" } as const;
      await tx.insert(schema.raceOrganisers).values({ raceId, organisationId, setBy: accountId, setAt: now })
        .onConflictDoUpdate({ target: schema.raceOrganisers.raceId, set: { organisationId, setBy: accountId, setAt: now } });
    } else {
      await tx.delete(schema.raceOrganisers).where(eq(schema.raceOrganisers.raceId, raceId));
    }
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "race", entityId: raceId, action: "RACE_ORGANISER_SET",
      actorKind: "USER_ACCOUNT", actorId: accountId, after: { organisationId }, createdAt: now });
    return { status: "ok", view: (await view(tx, raceId, accountId, now))! } as const;
  });
}

export type RaceClubArchiveResult = Failure | { status: "no-space" | "secret" | "already" | "not-lifted" } | { status: "ok"; view: RaceClubArchiveView };

/**
 * Den senast inlästa banfilen (IOF CourseData): "Läs in banfil" (en godkänd banfil, `source_snapshot` med källan COURSE_FILE),
 * annars importen av IOF XML. Eventors ögonblicksbilder (med anmälda) används aldrig.
 */
async function latestCourseFile(tx: DbExecutor, raceId: string): Promise<{ xml: string; fileName: string | null } | undefined> {
  const [snapshot] = await tx.select({ xml: schema.sourceSnapshots.originalXml, fileName: schema.sourceSnapshots.fileName, at: schema.sourceSnapshots.appliedAt })
    .from(schema.sourceSnapshots).where(and(eq(schema.sourceSnapshots.raceId, raceId), eq(schema.sourceSnapshots.source, "COURSE_FILE"),
      sql`${schema.sourceSnapshots.appliedAt} is not null`, sql`${schema.sourceSnapshots.originalXml} is not null`))
    .orderBy(desc(schema.sourceSnapshots.appliedAt)).limit(1);
  const [imported] = await tx.select({ xml: schema.importFiles.originalXml, at: schema.importFiles.createdAt }).from(schema.importFiles)
    .where(and(eq(schema.importFiles.raceId, raceId), eq(schema.importFiles.kind, "CourseData"))).orderBy(desc(schema.importFiles.createdAt)).limit(1);
  if (snapshot?.xml && (!imported || snapshot.at! >= imported.at)) return { xml: snapshot.xml, fileName: snapshot.fileName?.slice(0, 200) ?? null };
  return imported ? { xml: imported.xml, fileName: null } : undefined;
}

const stem = (fileName: string) => fileName.replace(/\.[A-Za-z0-9]{1,6}$/u, "").trim();
const safeName = (value: string) => value.replace(/[^\p{L}\p{N} ._()-]/gu, "_").trim().slice(0, 120) || "banor";

/** Låset på tävlingens arkivering (Lägg i, Ta ur, rutan och den automatiska). */
export async function lockRaceClubArchive(tx: DbExecutor, raceId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`race-club-archive:${raceId}`}, 0))`);
}

/** Kontrollerna som gäller båda (tävlingens administratör, klubbarkivets administratör) och arkivet. */
async function dualAdmin(tx: DbExecutor, input: RaceSessionProof, now: Date) {
  const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
  if (auth.status !== "authenticated") return auth;
  const { raceId, accountId } = auth.principal;
  await lockRaceClubArchive(tx, raceId);
  const [organiser] = await tx.select().from(schema.raceOrganisers).where(eq(schema.raceOrganisers.raceId, raceId));
  if (!organiser) return { status: "no-space" } as const;
  const [setting] = await tx.select({ clubId: schema.clubSettings.clubId }).from(schema.clubSettings)
    .where(eq(schema.clubSettings.organisationId, organiser.organisationId));
  if (!setting) return { status: "no-space" } as const;
  const member = await clubMembership(tx, { accountId, clubId: setting.clubId }, "update");
  // Arkivets existens röjs inte för den som inte är med: samma svar som utan arkiv.
  if (!member) return { status: "no-space" } as const;
  if (!clubRoleAtLeast(member.role, "ADMIN")) return { status: "forbidden" } as const;
  return { status: "ok", raceId, accountId, clubId: setting.clubId } as const;
}

/**
 * Inlyftet i anroparens transaktion (Lägg i klubbarkivet och den automatiska arkiveringen). Anroparen har prövat behörigheten
 * för `accountId` (administratör i tävlingen och i klubbytan), banhemligheten och tagit låset på tävlingens arkiv.
 */
export async function liftInTransaction(tx: DbExecutor, input: { raceId: string; clubId: string; accountId: string; now: Date;
  beforeFinished: boolean; automatic: boolean }): Promise<{ status: "already" } | { status: "lifted"; entryId: string }> {
  const { raceId, clubId, accountId, now, beforeFinished, automatic } = input;
  const prior = await liftOf(tx, raceId, clubId);
  if (prior?.entryId) return { status: "already" } as const;
  const facts = (await raceFacts(tx, raceId))!;
  if (prior) await tx.delete(schema.raceClubArchives).where(eq(schema.raceClubArchives.id, prior.lift.id));
  const title = raceTitle(facts.event.name, facts.race.name).slice(0, 200);

  // Kartan: samma innehåll är en version en gång per klubb (ADR-0194 beslut 2); annars en ny version av kartan med samma namn.
  const [source] = await tx.select().from(schema.raceMapSources).where(eq(schema.raceMapSources.raceId, raceId));
  const [agreement] = await tx.select().from(schema.raceMapAgreements).where(eq(schema.raceMapAgreements.raceId, raceId));
  let versionId: string | null = null, createdMapId: string | null = null, createdVersionId: string | null = null;
  const mapName = (agreement?.mapName || (source ? stem(source.fileName) : "") || facts.event.name).slice(0, 120);
  if (source?.contentSha256) {
    const [same] = await tx.select({ id: schema.clubMapVersions.id }).from(schema.clubMapVersions)
      .where(and(eq(schema.clubMapVersions.clubId, clubId), eq(schema.clubMapVersions.contentSha256, source.contentSha256)));
    if (same) versionId = same.id;
    else {
      const [named] = await tx.select({ id: schema.clubMaps.id }).from(schema.clubMaps)
        .where(and(eq(schema.clubMaps.clubId, clubId), sql`lower(${schema.clubMaps.name}) = lower(${mapName})`)).limit(1);
      let mapId = named?.id;
      if (!mapId) {
        mapId = createdMapId = randomUUID();
        await tx.insert(schema.clubMaps).values({ id: mapId, clubId, name: mapName, ownership: agreement?.ownership ?? "CLUB",
          ownerKind: agreement?.ownerKind ?? "CLUB", ownerName: agreement?.ownerName ?? null, agreement: agreement?.agreement ?? null,
          validUntil: agreement?.validUntil ?? null, contact: agreement?.contact ?? null, trainingOnly: agreement?.trainingOnly ?? false,
          feePerPrint: agreement?.feePerPrint ?? false, noPublicDisplay: agreement?.noPublicDisplay ?? false, createdAt: now, createdBy: accountId,
          updatedAt: now });
      }
      versionId = createdVersionId = randomUUID();
      await tx.insert(schema.clubMapVersions).values({ id: versionId, clubId, mapId, contentSha256: source.contentSha256, fileName: source.fileName,
        format: source.format, byteLength: source.byteLength, versionDate: facts.race.raceDate, note: `Från tävlingen ${title}`.slice(0, 500),
        uploadedBy: accountId, uploadedAt: now, sourcePath: null });
    }
  }

  // Banorna: banläggningens dokument som .ppen och IOF XML, annars den senast inlästa banfilen (IOF CourseData).
  const files: { kind: "PPEN" | "COURSE_DATA"; fileName: string; bytes: Buffer }[] = [];
  const [courseSetting] = await tx.select({ document: schema.courseSettings.document }).from(schema.courseSettings)
    .where(eq(schema.courseSettings.raceId, raceId));
  const note = courseSetting ? withoutMapNote(await coursesWithoutMap(tx, raceId, courseSetting.document as unknown as CourseSettingDocument)) : null;
  if (courseSetting) {
    const document = courseSetting.document as unknown as CourseSettingDocument;
    files.push({ kind: "PPEN", fileName: `${safeName(title)}.ppen`, bytes: Buffer.from(writePpen(document), "utf8") });
    files.push({ kind: "COURSE_DATA", fileName: `${safeName(title)} IOF.xml`, bytes: Buffer.from(writeIofCourseData(document,
      { mapBounds: source?.bounds, createTime: now }), "utf8") });
  } else {
    const imported = await latestCourseFile(tx, raceId);
    if (imported) files.push({ kind: "COURSE_DATA", fileName: imported.fileName ?? `${safeName(title)} banor.xml`, bytes: Buffer.from(imported.xml, "utf8") });
  }

  // ADR-0222: moment, nivåer och egna ord från terminsplaneringen när träningen skapades ur klubbens plan.
  const [planned] = await tx.select({ moments: schema.clubPlanSessions.moments, levels: schema.clubPlanSessions.levels,
    tags: schema.clubPlanSessions.tags }).from(schema.clubPlanSessions)
    .where(and(eq(schema.clubPlanSessions.raceId, raceId), eq(schema.clubPlanSessions.clubId, clubId))).limit(1);
  const entryId = randomUUID();
  await tx.insert(schema.clubArchiveEntries).values({ id: entryId, clubId, trainingDate: facts.race.raceDate, year: Number(facts.race.raceDate.slice(0, 4)),
    place: mapName, title, leader: null, tags: [...new Set([facts.race.raceType === "TRAINING" ? "Träning" : "Tävling", ...planned?.tags ?? []])].slice(0, 30),
    moments: planned?.moments ?? [], levels: planned?.levels ?? [], notes: note, sourcePath: null,
    importKey: `race:${raceId}:${entryId}`, createdAt: now, createdBy: accountId, updatedAt: now });
  if (versionId) await tx.insert(schema.clubArchiveEntryMaps).values({ entryId, versionId });
  const seen = new Set<string>();
  for (const file of files) {
    if (file.bytes.byteLength > CLUB_ARCHIVE_COURSE_FILE_MAX_BYTES) continue;
    const sha256 = createHash("sha256").update(file.bytes).digest("hex");
    if (seen.has(sha256)) continue;
    seen.add(sha256);
    await tx.insert(schema.clubArchiveCourseFiles).values({ id: randomUUID(), entryId, clubId, kind: file.kind, fileName: file.fileName, content: file.bytes,
      sha256, byteLength: file.bytes.byteLength, summary: courseFileSummary(file.kind, new Uint8Array(file.bytes)), mapVersionId: versionId,
      mapReference: source?.fileName ?? null, mapResolution: versionId ? "FOLDER" : "NONE", createdAt: now });
  }
  await tx.insert(schema.raceClubArchives).values({ id: randomUUID(), raceId, clubId, entryId, createdMapId, createdVersionId, raceName: title,
    raceDate: facts.race.raceDate, liftedBy: accountId, liftedAt: now });
  await snapshotPlanPeople(tx, { raceId, clubId, entryId });
  await markAutoArchived(tx, { raceId, now });
  await clubJournal(tx, { clubId, action: "CLUB_ARCHIVE_RACE_ADDED", actorAccountId: accountId,
    details: { entryId, raceId, mapVersionId: versionId, courseFiles: seen.size, beforeFinished, automatic }, now });
  await tx.insert(schema.auditEvents).values({ raceId, entityType: "race", entityId: raceId, action: "RACE_ADDED_TO_CLUB_ARCHIVE",
    actorKind: "USER_ACCOUNT", actorId: accountId, after: { clubId, entryId, ...(automatic ? { automatic } : {}) }, createdAt: now });
  return { status: "lifted", entryId } as const;
}

/** "Lägg i klubbarkivet". */
export async function liftRaceToClubArchive(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date()): Promise<RaceClubArchiveResult> {
  const parsed = raceClubArchiveLiftRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const actor = await dualAdmin(tx, input, now);
    if (actor.status !== "ok") return actor;
    const { raceId, accountId, clubId } = actor;
    const facts = (await raceFacts(tx, raceId))!;
    const coursesPublic = await coursesArePublic(tx, raceId);
    if (!raceFinishedForArchive({ raceDate: facts.race.raceDate, today: localRaceDate(now, facts.event.timeZone), coursesPublic })
      && !parsed.data.confirmSecrecy) return { status: "secret" } as const;
    const lifted = await liftInTransaction(tx, { raceId, clubId, accountId, now, beforeFinished: parsed.data.confirmSecrecy, automatic: false });
    if (lifted.status === "already") return lifted;
    return { status: "ok", view: (await view(tx, raceId, accountId, now))! } as const;
  });
}

/**
 * Ägaren 2026-11-12: rutan "Lägg i klubbarkivet när träningen är klar". Samma behörighet som Lägg i klubbarkivet (administratör
 * i tävlingen och i klubbytan; klubbytans existens röjs inte för den som inte är med). Auditpost på tävlingen.
 */
export async function setRaceClubArchiveAutoAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date())
  : Promise<RaceClubArchiveResult> {
  return db.transaction(async tx => {
    // Behörigheten först: den som inte får ändra får 401/403, inte 400, oavsett vad som skickades.
    const actor = await dualAdmin(tx, input, now);
    if (actor.status !== "ok") return actor;
    const parsed = raceClubArchiveAutoRequestSchema.safeParse(input.request);
    if (!parsed.success) return { status: "invalid-request" } as const;
    const { raceId, accountId } = actor;
    const before = await autoArchiveRow(tx, raceId);
    await setAutoArchive(tx, { raceId, enabled: parsed.data.enabled, actorId: accountId, now });
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "race", entityId: raceId, action: "RACE_CLUB_ARCHIVE_AUTO_SET",
      actorKind: "USER_ACCOUNT", actorId: accountId, before: { enabled: before?.enabled ?? null }, after: { enabled: parsed.data.enabled },
      createdAt: now });
    return { status: "ok", view: (await view(tx, raceId, accountId, now))! } as const;
  });
}

/** "Ta ur klubbarkivet": träningen tas bort; tävlingen ändras inte. */
export async function removeRaceFromClubArchive(db: Database, input: RaceSessionProof, now = new Date()): Promise<RaceClubArchiveResult> {
  return db.transaction(async tx => {
    const actor = await dualAdmin(tx, input, now);
    if (actor.status !== "ok") return actor;
    const { raceId, accountId, clubId } = actor;
    const prior = await liftOf(tx, raceId, clubId);
    if (!prior) return { status: "not-lifted" } as const;
    const entryId = prior.lift.entryId;
    if (prior.entryId) {
      await forgetEntryThumbnail(tx, entryId);
      await forgetArchivePeople(tx, entryId);
      await tx.delete(schema.clubArchiveCourseFiles).where(eq(schema.clubArchiveCourseFiles.entryId, entryId));
      await tx.delete(schema.clubArchiveEntryMaps).where(eq(schema.clubArchiveEntryMaps.entryId, entryId));
      await tx.delete(schema.clubArchiveEntries).where(eq(schema.clubArchiveEntries.id, entryId));
    }
    await tx.delete(schema.raceClubArchives).where(eq(schema.raceClubArchives.id, prior.lift.id));
    await dropUnusedCreated(tx, prior.lift.createdVersionId, prior.lift.createdMapId);
    await clubJournal(tx, { clubId, action: "CLUB_ARCHIVE_RACE_REMOVED", actorAccountId: accountId, details: { entryId, raceId }, now });
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "race", entityId: raceId, action: "RACE_REMOVED_FROM_CLUB_ARCHIVE",
      actorKind: "USER_ACCOUNT", actorId: accountId, after: { clubId, entryId }, createdAt: now });
    return { status: "ok", view: (await view(tx, raceId, accountId, now))! } as const;
  });
}

/** Kartversionen och kartan som inlyftet skapade tas bort när inget annat i arkivet eller någon grupp använder dem. */
async function dropUnusedCreated(tx: DbExecutor, versionId: string | null, mapId: string | null): Promise<void> {
  if (versionId) {
    // ADR-0219: ett kartprojekt som utgår från versionen, eller en version som skrivits ur ett projekt, håller den kvar.
    const [used] = (await tx.execute<{ used: boolean }>(sql`select exists (select 1 from club_archive_entry_map where version_id = ${versionId})
      or exists (select 1 from club_archive_course_file where map_version_id = ${versionId})
      or exists (select 1 from map_project where base_version_id = ${versionId})
      or exists (select 1 from map_project_output where version_id = ${versionId}) as used`)).rows;
    if (!used?.used) {
      await tx.delete(schema.clubArchiveEntryThumbnails).where(eq(schema.clubArchiveEntryThumbnails.mapVersionId, versionId));
      await tx.delete(schema.clubMapVersionChecks).where(eq(schema.clubMapVersionChecks.versionId, versionId));
      await tx.delete(schema.clubMapVersions).where(eq(schema.clubMapVersions.id, versionId));
    }
  }
  if (mapId) {
    const [used] = (await tx.execute<{ used: boolean }>(sql`select exists (select 1 from club_map_version where map_id = ${mapId})
      or exists (select 1 from training_group_map where club_map_id = ${mapId}) as used`)).rows;
    if (!used?.used) {
      // Översynen B6: planens rader tappar kartan (i stället för att peka på en karta som inte finns).
      await tx.update(schema.clubPlanSessions).set({ clubMapId: null }).where(eq(schema.clubPlanSessions.clubMapId, mapId));
      await tx.delete(schema.clubMaps).where(eq(schema.clubMaps.id, mapId));
    }
  }
}

