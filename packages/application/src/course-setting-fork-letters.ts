import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { courseSettingDocumentSchema } from "@o-tid/contracts";
import {
  diffTouches, isForkedCourse, withForkLetterLocks, withTransferredLetters, type CourseSettingDocument, type ForkLetterLockRequest
} from "@o-tid/course-setting";
import { schema } from "@o-tid/database";
import { courseSettingRead, loadRow, store, type Failure, type ReadProof, type Transaction } from "./course-setting";
import { requireCourseSettingAccess } from "./course-setting-access";
import type { Database } from "@o-tid/database";
import type { CourseFileAction, CourseFileProjection, CurrentState, PlannedRow } from "./source-sync-model";

/**
 * ADR-0175, tillägg 2026-11-21 (b): servern låser nycklarna i banläggningens dokument när de fått betydelse utanför
 * banläggningen, och sparar bokstäverna som fördes över till tävlingen. Låset står i dokumentet (`Course.forkLetterLock`),
 * så att samma ändring ger samma bokstäver i webbläsaren och på servern; servern skriver en ny version (som ett sparande).
 *
 * Banläggningens bana paras med tävlingens på namnet (överföringen ger tävlingens bana banläggningens namn). Skälen:
 * - PRINT: ett tryckjobb (PDF) med en variant av banan, eller en utskriven kartbuntslista för banans klasser.
 * - START_LIST: en publicerad startlista och banan har klasser i tävlingen.
 * - ASSIGNED: en löpare eller stafettsträcka i banans klasser har en tilldelad variant.
 * En bana vars lås hävts för hand (`forkLetterUnlockedAt`) låses igen bara av en händelse efter det (tryck eller publicering
 * senare, eller en ny fördelning: `forceAssigned`).
 */
const normalized = (name: string) => name.trim().toLocaleLowerCase("sv-SE");

interface RaceFacts {
  /** Tävlingens bana (normaliserat namn) → banans id. */
  readonly courses: ReadonlyMap<string, string>;
  /** Tävlingens banor med tilldelade varianter. */
  readonly assigned: ReadonlySet<string>;
  /** Tävlingens banor med klasser. */
  readonly withClasses: ReadonlySet<string>;
  /** Senaste publicerade startlistan (null = ingen eller tillbakadragen). */
  readonly startListAt: Date | null;
  /** Senaste kartbuntslistan. */
  readonly bundleAt: Date | null;
  /** Banläggningens bana → senaste tryckjobb med en variant och antal kartor med variant i jobben. */
  readonly printed: ReadonlyMap<string, { readonly at: Date; readonly maps: number }>;
}

async function raceFacts(tx: Transaction, raceId: string): Promise<RaceFacts> {
  const courseRows = await tx.select({ id: schema.courses.id, name: schema.courses.name }).from(schema.courses).where(eq(schema.courses.raceId, raceId));
  const classRows = await tx.select({ courseId: schema.courseVersions.courseId }).from(schema.classes)
    .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId)).where(eq(schema.classes.raceId, raceId));
  const assignedRows = await tx.selectDistinct({ courseId: schema.courseVersions.courseId }).from(schema.entries)
    .innerJoin(schema.classes, eq(schema.classes.id, schema.entries.classId))
    .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
    .where(and(eq(schema.entries.raceId, raceId), isNotNull(schema.entries.courseVariantCode)));
  const legRows = await tx.selectDistinct({ courseId: schema.courseVersions.courseId }).from(schema.relayLegs)
    .innerJoin(schema.classes, eq(schema.classes.id, schema.relayLegs.classId))
    .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, sql`coalesce(${schema.relayLegs.courseVersionId}, ${schema.classes.courseVersionId})`))
    .where(and(eq(schema.relayLegs.raceId, raceId), isNotNull(schema.relayLegs.courseVariantCode)));
  const [publication] = await tx.select({ action: schema.startListPublications.action, at: schema.startListPublications.decidedAt })
    .from(schema.startListPublications).where(eq(schema.startListPublications.raceId, raceId)).orderBy(desc(schema.startListPublications.revision)).limit(1);
  const [bundle] = await tx.select({ at: schema.mapPrints.printedAt }).from(schema.mapPrints)
    .where(and(eq(schema.mapPrints.raceId, raceId), eq(schema.mapPrints.list, "BUNDLE")));
  const jobs = await tx.select({ request: schema.courseSettingPrintJobs.request, at: schema.courseSettingPrintJobs.createdAt })
    .from(schema.courseSettingPrintJobs).where(eq(schema.courseSettingPrintJobs.raceId, raceId)).orderBy(desc(schema.courseSettingPrintJobs.createdAt)).limit(1000);
  const printed = new Map<string, { at: Date; maps: number }>();
  for (const job of jobs) {
    const items = (job.request as { items?: unknown }).items;
    if (!Array.isArray(items)) continue;
    for (const item of items as { course?: unknown; variant?: unknown }[]) {
      if (typeof item.course !== "string" || typeof item.variant !== "string" || item.variant === "") continue;
      const copies = 1;
      const known = printed.get(item.course);
      printed.set(item.course, { at: known && known.at > job.at ? known.at : job.at, maps: (known?.maps ?? 0) + copies });
    }
  }
  return { courses: new Map(courseRows.map(row => [normalized(row.name), row.id])), withClasses: new Set(classRows.map(row => row.courseId)),
    assigned: new Set([...assignedRows, ...legRows].map(row => row.courseId)), startListAt: publication?.action === "PUBLISH" ? publication.at : null,
    bundleAt: bundle?.at ?? null, printed };
}

/** Låsen som tävlingens läge ger (i ordning: tryck, startlista, tilldelning). */
function lockRequests(document: CourseSettingDocument, facts: RaceFacts, now: Date, forceAssigned: boolean): ForkLetterLockRequest[] {
  const at = now.toISOString();
  const out: ForkLetterLockRequest[] = [];
  for (const course of document.courses) {
    if (course.kind === "SCORE" || course.forkLetterLock || !isForkedCourse(document, course.id)) continue;
    const unlocked = course.forkLetterUnlockedAt ? new Date(course.forkLetterUnlockedAt) : null;
    const after = (time: Date | null) => time !== null && (unlocked === null || time > unlocked);
    const raceCourse = facts.courses.get(normalized(course.name));
    const assigned = raceCourse !== undefined && facts.assigned.has(raceCourse);
    const printed = facts.printed.get(course.id);
    if (printed) out.push({ course: course.id, reason: "PRINT", at, force: after(printed.at) });
    if (assigned && facts.bundleAt) out.push({ course: course.id, reason: "PRINT", at, force: after(facts.bundleAt) });
    if (raceCourse !== undefined && facts.withClasses.has(raceCourse) && facts.startListAt) {
      out.push({ course: course.id, reason: "START_LIST", at, force: after(facts.startListAt) });
    }
    if (assigned) out.push({ course: course.id, reason: "ASSIGNED", at, force: forceAssigned });
  }
  return out;
}

/** Skriver dokumentet som en ny version när `change` ändrar det (låset per tävling som vid sparande). Ger versionen. */
async function storeChange(tx: Transaction, raceId: string, actorId: string, now: Date, change: (document: CourseSettingDocument) => CourseSettingDocument)
  : Promise<number | undefined> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"course-setting:" + raceId}, 0))`);
  const current = await loadRow(tx, raceId);
  if (!current) return undefined;
  const before = current.document as unknown as CourseSettingDocument;
  const after = change(before);
  if (after === before) return undefined;
  const parsed = courseSettingDocumentSchema.safeParse(after);
  if (!parsed.success) return undefined;
  const saved = await store(tx, { raceId, actorId, now, current, kind: "SAVE", document: parsed.data,
    change: { touches: diffTouches(before, after), requestId: randomUUID(), result: () => ({}) } });
  await tx.insert(schema.auditEvents).values({ raceId, entityType: "course_setting", entityId: raceId, action: "COURSE_SETTING_FORK_LETTERS_LOCKED",
    actorKind: "USER_ACCOUNT", actorId, after: { version: saved.version, courses: after.courses.filter(course => {
      const old = before.courses.find(row => row.id === course.id);
      return JSON.stringify([old?.forkLetterLock, old?.transferredLetters]) !== JSON.stringify([course.forkLetterLock, course.transferredLetters]);
    }).map(course => ({ course: course.id, lock: course.forkLetterLock?.reason ?? null })) }, createdAt: now });
  return saved.version;
}

/** Banläggningen saknar ett lås som tävlingens läge ger (billig kontroll innan något låses). */
async function needsLocks(tx: Transaction, raceId: string, document: CourseSettingDocument, now: Date, forceAssigned: boolean): Promise<RaceFacts | undefined> {
  if (!document.courses.some(course => course.kind !== "SCORE" && !course.forkLetterLock && isForkedCourse(document, course.id))) return undefined;
  const facts = await raceFacts(tx, raceId);
  return withForkLetterLocks(document, lockRequests(document, facts, now, forceAssigned)) === document ? undefined : facts;
}

/**
 * Låser banläggningens banor som tävlingens läge kräver (tryck, publicerad startlista, tilldelade varianter). Anropas när
 * något sådant händer (tryckjobb, kartbuntslista, fördelning, publicering; `forceAssigned` vid en ny fördelning), vid
 * överföringen och när editorn läser dokumentet. Ger den nya versionen, eller undefined när inget ändrades.
 */
export async function lockForkLettersFromRace(tx: Transaction, raceId: string, actorId: string, now: Date, options: { readonly forceAssigned?: boolean } = {})
  : Promise<number | undefined> {
  const row = await loadRow(tx, raceId);
  if (!row) return undefined;
  const facts = await needsLocks(tx, raceId, row.document as unknown as CourseSettingDocument, now, options.forceAssigned ?? false);
  if (!facts) return undefined;
  return storeChange(tx, raceId, actorId, now, document => withForkLetterLocks(document, lockRequests(document, facts, now, options.forceAssigned ?? false)));
}

/** Vid läsning i editorn: lås det som tävlingens läge kräver innan dokumentet visas (en egen, kort transaktion). */
export async function lockForkLettersOnRead(db: Database, input: ReadProof, now: Date): Promise<void> {
  await db.transaction(async tx => {
    const auth = await requireCourseSettingAccess(tx, { ...input, required: "COMMENT" }, now);
    if (auth.status !== "authenticated") return;
    await lockForkLettersFromRace(tx, auth.principal.raceId, auth.principal.accountId, now);
  });
}

/**
 * Efter en godkänd överföring: grenarnas bokstäver sparas (`transferredLetters`) för banorna som fördes över (en ny eller
 * ändrad bana i de valda raderna, eller en bana utan omnumrering), och banorna låses om tävlingens läge kräver det.
 */
export async function recordTransferredForkLetters(tx: Transaction, raceId: string, actorId: string, now: Date, projection: CourseFileProjection,
  rows: readonly PlannedRow<CourseFileAction>[], state: CurrentState): Promise<void> {
  const letters = projection.data.forkLetters ?? [];
  if (letters.length === 0) return;
  const created = new Set(rows.flatMap(({ action }) => action.type === "CREATE_COURSE" ? [action.externalId] : []));
  const changed = new Set(rows.flatMap(({ action }) => action.type === "CHANGE_COURSE" ? [action.courseId] : []));
  const applied = letters.filter(row => {
    const local = state.courses.find(course => course.externalId === row.courseExternalId) ??
      state.courses.find(course => normalized(course.name) === normalized(row.courseExternalId.replace(/^family:/, "")));
    return created.has(row.courseExternalId) || (local !== undefined && changed.has(local.id)) || row.renames === undefined;
  });
  if (applied.length === 0) return;
  const facts = await raceFacts(tx, raceId);
  await storeChange(tx, raceId, actorId, now, document => {
    const recorded = withTransferredLetters(document, applied.map(row => ({ course: row.course, letters: row.letters })));
    return withForkLetterLocks(recorded, lockRequests(recorded, facts, now, false));
  });
}

export interface ForkLetterFacts {
  readonly raceId: string;
  readonly courses: readonly {
    readonly course: string;
    /** Kartor med variant i tryckjobben (null = inga). */
    readonly printedMaps: number | null;
    readonly startListPublished: boolean;
    /** Löpare med en tilldelad variant (högst 200) och hur många de är. */
    readonly runners: readonly { readonly name: string; readonly className: string; readonly code: string }[];
    readonly runnerCount: number;
  }[];
}

/** Det som berörs om nycklarna ordnas om eller låset hävs, per gafflad bana i banläggningen (EDIT). */
export async function readForkLetterFactsAsAdmin(db: Database, input: ReadProof, now = new Date()): Promise<Failure | { status: "ok"; response: ForkLetterFacts }> {
  return courseSettingRead(db, input, now, async (tx, raceId) => {
    const row = await loadRow(tx, raceId);
    if (!row) return { status: "not-found" as const };
    const document = row.document as unknown as CourseSettingDocument;
    const facts = await raceFacts(tx, raceId);
    const runners = await tx.select({ givenName: schema.entries.givenName, familyName: schema.entries.familyName, code: schema.entries.courseVariantCode,
      className: schema.classes.name, courseId: schema.courseVersions.courseId }).from(schema.entries)
      .innerJoin(schema.classes, eq(schema.classes.id, schema.entries.classId))
      .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
      .where(and(eq(schema.entries.raceId, raceId), isNotNull(schema.entries.courseVariantCode)))
      .orderBy(schema.classes.name, schema.entries.familyName, schema.entries.givenName).limit(20_000);
    const courses = document.courses.filter(course => course.kind !== "SCORE" && isForkedCourse(document, course.id)).map(course => {
      const raceCourse = facts.courses.get(normalized(course.name));
      const own = raceCourse === undefined ? [] : runners.filter(runner => runner.courseId === raceCourse);
      return { course: course.id, printedMaps: facts.printed.get(course.id)?.maps ?? null,
        startListPublished: facts.startListAt !== null && raceCourse !== undefined && facts.withClasses.has(raceCourse),
        runners: own.slice(0, 200).map(runner => ({ name: `${runner.givenName} ${runner.familyName}`.trim() || "?", className: runner.className, code: runner.code! })),
        runnerCount: own.length };
    });
    return { status: "ok" as const, response: { raceId, courses } };
  }, "EDIT");
}
