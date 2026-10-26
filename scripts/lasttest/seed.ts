/**
 * Lasttestets testdata (PLAN.md steg 51, docs/lasttest.md). Skapar i en TOM databas:
 *   - "Lasttest individuell": 3 000 löpare i 40 klasser, varav 6 klasser på gafflade banor (fjärilar, 4 varianter),
 *     lottade starttider (2 min), publicerad startlista; en stor bana delas av fyra klasser (> 300 löpare).
 *   - "Lasttest stafett": 300 lag × 3 sträckor på en gafflad bana (masstart och växling).
 *   - "Lasttest 25-manna": 300 lag × 25 sträckor.
 * Läser in de flesta avläsningarna direkt via applikationslagret (samma kod som avläsningens API) och skriver
 * ett manifest med resten, som lastskriptet (load.ts) skickar över HTTP.
 *
 *   DATABASE_URL=… pnpm lasttest:seed -- --out /tmp/otid-lasttest/manifest.json [--preread 2700] [--small]
 *
 * Endast påhittade namn. Körs inte mot produktion.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import type { DeviceBatch } from "../../packages/contracts/src/index.ts";
import { createDatabase, migrate } from "../../packages/database/src/index.ts";
import {
  commitStartDrawAsAdmin, createOrganizerEvent, createRelayClassAsAdmin, decideStartListPublicationAsAdmin,
  getStartListPublicationPreviewAsAdmin, importIofXmlAsAdmin, previewStartDrawAsAdmin, ingestReadoutsAsAdmin, loadRaceSnapshot, loadStartDrawSetupAsAdmin,
  loginUserAccount, registerRelayTeamAsAdmin, registerUserAccount, setRacePublicationAsAdmin
} from "../../packages/application/src/index.ts";
import { clubName, describe, EMAIL, fail, PASSWORD, random, readoutEvent, runnerName, TIME_ZONE, type ReadoutRun } from "./common.ts";

const { values: args } = parseArgs({ options: {
  out: { type: "string", default: "/tmp/otid-lasttest/manifest.json" },
  preread: { type: "string" },
  small: { type: "boolean", default: false },
  races: { type: "string", default: "individual,relay3,relay25" },
  teams: { type: "string" },
  "relay25-legs-read": { type: "string" }
} });
const ONLY = new Set(args.races.split(","));
const SMALL = args.small === true;
const RUNNERS = SMALL ? 300 : 3_000;
const CLASSES = SMALL ? 8 : 40;
const TEAMS = Number(args.teams ?? (SMALL ? 30 : 300));
const PREREAD = Number(args.preread ?? (RUNNERS - Math.round(RUNNERS / 10)));
const MINUTE = 60_000;

type Db = ReturnType<typeof createDatabase>;
type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };
type PlannedRun = ReadoutRun & { name: string };
type RacePlan = { raceId: string; shortCode: string; pending: PlannedRun[]; extra: Record<string, string> };

const xmlEscape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const header = (root: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<${root} xmlns="http://www.orienteering.org/datastandard/3.0" ` +
  `iofVersion="3.0" createTime="${new Date().toISOString()}" creator="O-Tid lasttest">\n<Event><Name>Lasttest</Name></Event>\n`;

type CourseSpec = { name: string; family?: string; controls: number[] };

function courseDataXml(courses: readonly CourseSpec[], assignments: readonly { className: string; course: string; family?: boolean }[]): string {
  const codes = [...new Set(courses.flatMap((course) => course.controls))].sort((a, b) => a - b);
  const parts = [header("CourseData"), "<RaceCourseData>\n<Map><Scale>10000</Scale></Map>\n",
    `<Control type="Start"><Id>S1</Id></Control>\n`, ...codes.map((code) => `<Control><Id>${code}</Id></Control>\n`),
    `<Control type="Finish"><Id>F1</Id></Control>\n`];
  courses.forEach((course, index) => {
    parts.push(`<Course><Id>${index + 1}</Id><Name>${xmlEscape(course.name)}</Name>`,
      course.family ? `<CourseFamily>${xmlEscape(course.family)}</CourseFamily>` : "",
      `<Length>${course.controls.length * 350}</Length><Climb>${course.controls.length * 5}</Climb>\n`,
      `<CourseControl type="Start"><Control>S1</Control></CourseControl>\n`,
      ...course.controls.map((code) => `<CourseControl><Control>${code}</Control></CourseControl>\n`),
      `<CourseControl type="Finish"><Control>F1</Control></CourseControl>\n</Course>\n`);
  });
  for (const assignment of assignments) {
    parts.push(`<ClassCourseAssignment><ClassId>${xmlEscape(assignment.className)}</ClassId><ClassName>${xmlEscape(assignment.className)}</ClassName>`,
      assignment.family ? `<CourseFamily>${xmlEscape(assignment.course)}</CourseFamily>` : `<CourseName>${xmlEscape(assignment.course)}</CourseName>`,
      "</ClassCourseAssignment>\n");
  }
  parts.push("</RaceCourseData>\n</CourseData>\n");
  return parts.join("");
}

function entryListXml(entries: readonly { id: string; givenName: string; familyName: string; club: string; card: number; className: string }[]): string {
  return header("EntryList") + entries.map((entry) => `<PersonEntry><Id>${entry.id}</Id><Person><Name><Family>${xmlEscape(entry.familyName)}</Family>` +
    `<Given>${xmlEscape(entry.givenName)}</Given></Name></Person><Organisation><Name>${xmlEscape(entry.club)}</Name></Organisation>` +
    `<ControlCard punchingSystem="SPORTident">${entry.card}</ControlCard><Class><Id>${xmlEscape(entry.className)}</Id>` +
    `<Name>${xmlEscape(entry.className)}</Name></Class></PersonEntry>\n`).join("") + "</EntryList>\n";
}

/** Gafflad bana med två fjärilar: varianterna AC, AD, BC och BD (samma form som fixtures/iof/course-data-forked.xml). */
function forkedFamily(family: string, base: readonly number[], centers: readonly [number, number], loops: readonly (readonly number[])[]): CourseSpec[] {
  const [a, b, c, d] = loops as [readonly number[], readonly number[], readonly number[], readonly number[]];
  const half = Math.floor(base.length / 2);
  return (["AC", "AD", "BC", "BD"] as const).map((code) => {
    const first = code[0] === "A" ? [a, b] : [b, a];
    const second = code[1] === "C" ? [c, d] : [d, c];
    const controls = [...base.slice(0, half), centers[0], ...first[0]!, centers[0], ...first[1]!, centers[0],
      ...base.slice(half), centers[1], ...second[0]!, centers[1], ...second[1]!, centers[1]];
    return { name: `${family}-${code}`, family, controls };
  });
}

function pickControls(rng: () => number, count: number, first: number): number[] {
  const pool = Array.from({ length: 60 }, (_, index) => 61 + index).filter((code) => code !== first);
  const picked = [first];
  while (picked.length < count) picked.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
  return picked;
}

async function account(db: Db["db"]) {
  const registered = await registerUserAccount(db, { formatVersion: 1, email: EMAIL, displayName: "Lasttestarrangör", password: PASSWORD });
  const result = registered.status === "conflict" ? await loginUserAccount(db, { formatVersion: 1, email: EMAIL, password: PASSWORD }) : registered;
  if (result.status !== "authenticated") fail("Lasttestkontot finns med ett annat lösenord. Använd en tom databas.");
  return { sessionToken: result.sessionToken, csrfCookie: result.csrfToken, csrfHeader: result.csrfToken };
}

async function createRace(db: Db["db"], owner: Omit<Proof, "raceId">, eventName: string): Promise<{ proof: Proof; shortCode: string }> {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE }).format(new Date());
  const created = await createOrganizerEvent(db, { ...owner, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName, raceName: eventName, raceDate: today, timeZone: TIME_ZONE }) });
  if (created.status !== "created") fail(`Tävlingen kunde inte skapas (${created.status}).`);
  const proof = { ...owner, raceId: created.response.raceId };
  const published = await setRacePublicationAsAdmin(db, { ...proof, published: true });
  if (published.status !== "saved") fail(`Tävlingen kunde inte publiceras (${published.status}).`);
  return { proof, shortCode: published.response.publication.shortCode };
}

async function importXml(db: Db["db"], proof: Proof, xml: string) {
  const result = await importIofXmlAsAdmin(db, { ...proof, idempotencyKey: `iof-import:${randomUUID()}`, xmlBytes: Buffer.from(xml) });
  if (result.status !== "stored") fail(`Importen misslyckades (${result.status}${"issues" in result ? `: ${result.issues.join("; ")}` : ""}).`);
}

/** Varje löpares bana (variant eller klassens/sträckans) ur avläsningspaketet. */
async function controlsByEntry(db: Db["db"], raceId: string): Promise<Map<string, { controls: number[]; fixedStart?: Date; card: string }>> {
  const snapshot = await loadRaceSnapshot(db, raceId);
  const versions = new Map(snapshot.courses.flatMap((course) => course.versions).map((version) => [version.id, version]));
  const classes = new Map(snapshot.classes.map((row) => [row.id, row]));
  const cards = new Map(snapshot.cardAssignments.filter((row) => row.active).map((row) => [row.entryId, row.cardNumber]));
  const out = new Map<string, { controls: number[]; fixedStart?: Date; card: string }>();
  for (const entry of snapshot.entries) {
    const version = versions.get(entry.courseVersionId ?? classes.get(entry.classId)!.courseVersionId)!;
    const variant = entry.courseVariantCode ? version.variants?.find((row) => row.code === entry.courseVariantCode) : undefined;
    const controls = (variant ? variant.controls : version.controls).map((control) => control.controlCode);
    out.set(entry.id, { controls, card: cards.get(entry.id) ?? fail("Löparen saknar bricka"),
      ...(entry.fixedStartTime ? { fixedStart: new Date(entry.fixedStartTime) } : {}) });
  }
  return out;
}

/** Läser in avläsningarna i satser om 25 (som en avläsningsdator med kö), via applikationslagret. */
async function ingestDirect(db: Db["db"], proof: Proof, pool: Db["pool"], runs: readonly PlannedRun[], label: string) {
  const deviceId = randomUUID(), sessionId = randomUUID();
  const started = Date.now();
  for (let offset = 0; offset < runs.length; offset += 25) {
    const packageVersion = (await pool.query<{ v: number }>("select snapshot_version as v from race where id = $1", [proof.raceId])).rows[0]!.v;
    const chunk = runs.slice(offset, offset + 25);
    const events = chunk.map((run, index) => readoutEvent(run, offset + index + 1, new Date(run.finishAt.getTime() + 30_000)));
    const batch: DeviceBatch = { deviceId, sessionId, packageVersion, firstSequence: offset + 1, lastSequence: offset + chunk.length, events };
    const result = await ingestReadoutsAsAdmin(db, { ...proof, batch });
    if (result.status !== "ok" || result.response.acknowledgements.some((ack) => ack.status !== "stored")) {
      fail(`Avläsningarna kunde inte sparas (${result.status}).`);
    }
    if ((offset / 25) % 20 === 19) process.stdout.write(`  ${label}: ${offset + chunk.length}/${runs.length} (${Math.round((Date.now() - started) / (offset + chunk.length))} ms/st)\n`);
  }
  const perReadout = runs.length === 0 ? 0 : (Date.now() - started) / runs.length;
  process.stdout.write(`  ${label}: ${runs.length} avläsningar på ${((Date.now() - started) / 1000).toFixed(0)} s (${perReadout.toFixed(0)} ms/st)\n`);
  return perReadout;
}

async function individual(db: Db["db"], pool: Db["pool"], owner: Omit<Proof, "raceId">): Promise<RacePlan> {
  const rng = random(51);
  const { proof, shortCode } = await createRace(db, owner, "Lasttest individuell");
  // Klasser: H/D i åldersklasser, storlekar som en stor nationell tävling (de största först).
  const ages = ["21", "20", "18", "16", "35", "40", "45", "50", "55", "60", "65", "70", "14", "12", "10", "21B", "21C", "Öppen 1", "Öppen 2", "Öppen 3"];
  const classNames = ages.flatMap((age) => [`H${age}`, `D${age}`]).slice(0, CLASSES);
  const weights = classNames.map((_, index) => 1.8 / (1 + index * 0.12) + 0.25);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const sizes = weights.map((weight) => Math.max(10, Math.floor(RUNNERS * weight / total)));
  sizes[0]! += RUNNERS - sizes.reduce((sum, size) => sum + size, 0);

  // Banor: de 6 största klasserna går på fyra gafflade banfamiljer; en vanlig bana delas av fyra klasser (> 300 löpare).
  const forked = SMALL ? 2 : 6;
  const families: CourseSpec[] = [];
  const familyNames = ["Elit", "Lång", "Mellan", "Junior"];
  for (let index = 0; index < Math.min(4, forked); index += 1) {
    const base = pickControls(rng, 12, 51 + index);
    families.push(...forkedFamily(familyNames[index]!, base, [41 + index * 2, 42 + index * 2], [[51, 52], [53, 54], [55, 56], [57, 58]].map((loop) => loop.map((code) => code + index * 10 + 100))));
  }
  const plainCount = SMALL ? 3 : 20;
  const plain: CourseSpec[] = Array.from({ length: plainCount }, (_, index) => ({ name: `Bana ${index + 1}`, controls: pickControls(rng, 10 + (index % 12), 31 + index) }));
  const assignments = classNames.map((className, index) => index < forked
    ? { className, course: familyNames[index % Math.min(4, forked)]!, family: true }
    : { className, course: plain[index >= forked && index < forked + 4 ? 0 : (index % (plainCount - 1)) + 1]!.name });
  await importXml(db, proof, courseDataXml([...families, ...plain], assignments));

  const entries = [];
  let runner = 0;
  for (const [classIndex, className] of classNames.entries()) {
    for (let index = 0; index < sizes[classIndex]!; index += 1, runner += 1) {
      entries.push({ id: `lt-${runner + 1}`, ...runnerName(runner), club: clubName(Math.floor(rng() * 150)), card: 8_200_001 + runner, className });
    }
  }
  await importXml(db, proof, entryListXml(entries));

  // Lottning: minutstart (1 min i klasser över 60 löpare, annars 2 min) och klubbseparering. Startfönstret ska sluta
  // halvannan timme före nu, så att alla hunnit i mål: förhandsvisa först och flytta första start.
  const setup = await loadStartDrawSetupAsAdmin(db, proof);
  if (setup.status !== "ok") fail(`Lottningen kunde inte läsas (${setup.status}).`);
  const settings = (firstStartTime: string) => ({ formatVersion: 1 as const, firstStartTime, clubSeparation: true,
    classes: setup.response.classes.map((row) => ({ classId: row.id, method: "MINUTE" as const, intervalMinutes: row.entryCount > 60 ? 1 : 2,
      vacancies: { kind: "COUNT" as const, value: 0 } })) });
  const probeStart = new Date(Math.floor(Date.now() / MINUTE) * MINUTE).toISOString();
  const probe = await previewStartDrawAsAdmin(db, { ...proof, request: settings(probeStart) });
  if (probe.status !== "ok") fail(`Lottningen kunde inte förhandsvisas (${probe.status}).`);
  const lastSlot = Math.max(...probe.response.classes.flatMap((row) => row.slots.map((slot) => Date.parse(slot.startTime))));
  const windowMs = lastSlot - Date.parse(probeStart);
  const firstStart = new Date(Math.floor((Date.now() - windowMs - 100 * MINUTE) / MINUTE) * MINUTE).toISOString();
  process.stdout.write(`  Startfönster ${Math.round(windowMs / MINUTE)} min, första start ${firstStart}\n`);
  const requestId = randomUUID();
  const drawn = await commitStartDrawAsAdmin(db, { ...proof, idempotencyKey: `start-draw:${requestId}`, request: { ...settings(firstStart),
    requestId, seed: probe.response.seed, confirmChanges: true } });
  if (drawn.status !== "drawn") fail(`Lottningen misslyckades (${drawn.status}).`);
  const preview = await getStartListPublicationPreviewAsAdmin(db, proof);
  if (preview.status !== "ok" || !preview.response.sourceHash) fail("Startlistan kunde inte förhandsvisas.");
  const decided = await decideStartListPublicationAsAdmin(db, { ...proof, idempotencyKey: `start-list-publication:${randomUUID()}`, request: { formatVersion: 1,
    action: "PUBLISH", expectedSourceHash: preview.response.sourceHash, expectedRevision: preview.response.latestDecision?.revision ?? 0 } });
  if (decided.status !== "decided") fail(`Startlistan kunde inte publiceras (${decided.status}).`);

  // Löptid 25–85 min; senaste start ska ha hunnit i mål före nu.
  const byEntry = await controlsByEntry(db, proof.raceId);
  const names = new Map((await pool.query<{ id: string; given_name: string; family_name: string }>(
    "select id, given_name, family_name from entry where race_id = $1", [proof.raceId])).rows.map((row) => [row.id, `${row.given_name} ${row.family_name}`]));
  const runs: PlannedRun[] = [...byEntry.entries()].map(([entryId, row]) => {
    const startAt = row.fixedStart ?? fail("Löparen saknar lottad starttid");
    return { cardNumber: Number(row.card), startAt, finishAt: new Date(startAt.getTime() + (25 + rng() * 60) * MINUTE),
      controlCodes: row.controls, name: names.get(entryId)! };
  }).sort((left, right) => left.finishAt.getTime() - right.finishAt.getTime());
  const lastFinish = runs.at(-1)!.finishAt.getTime();
  if (lastFinish > Date.now()) process.stdout.write(`  Varning: sista måltid ${Math.round((lastFinish - Date.now()) / MINUTE)} min efter nu.\n`);
  await ingestDirect(db, proof, pool, runs.slice(0, PREREAD), "individuell");

  const shared = (await pool.query<{ id: string }>("select id from course where race_id = $1 and name = $2", [proof.raceId, plain[0]!.name])).rows[0]!;
  const moved = (await pool.query<{ id: string }>("select id from class where race_id = $1 and name = $2", [proof.raceId, classNames[forked]!])).rows[0]!;
  return { raceId: proof.raceId, shortCode, pending: runs.slice(PREREAD),
    extra: { sharedCourseId: shared.id, sharedCourseName: plain[0]!.name, movedClassId: moved.id, movedClassName: classNames[forked]! } };
}

async function relay(db: Db["db"], pool: Db["pool"], owner: Omit<Proof, "raceId">, name: string, legs: number, legMinutes: [number, number],
  cardBase: number, forkedCourse: boolean, legsRead = legs - 1): Promise<RacePlan> {
  const rng = random(legs * 1_000 + 51);
  const { proof, shortCode } = await createRace(db, owner, name);
  const courses = forkedCourse ? forkedFamily("Stafett", pickControls(rng, 10, 31), [41, 42], [[151, 152], [153, 154], [155, 156], [157, 158]])
    : [{ name: "Stafett", controls: pickControls(rng, 8, 31) }];
  await importXml(db, proof, courseDataXml(courses, []));
  const course = (await pool.query<{ id: string }>("select id from course where race_id = $1 and name = 'Stafett'", [proof.raceId])).rows[0]
    ?? fail("Stafettbanan saknas");
  const massStart = new Date(Math.floor((Date.now() - (legs === 3 ? 3 : 4.5) * 60 * MINUTE) / MINUTE) * MINUTE);
  const classRequestId = randomUUID();
  const created = await createRelayClassAsAdmin(db, { ...proof, idempotencyKey: `relay-class:${classRequestId}`, request: { formatVersion: 1,
    requestId: classRequestId, name: legs === 3 ? "H21 stafett" : "25-manna", courseId: course.id,
    legs: Array.from({ length: legs }, (_, index) => ({ leg: index + 1, startMethod: index === 0 ? "MASS_START" : "CHANGEOVER",
      startTime: index === 0 ? massStart.toISOString() : null, variantCode: null })) } });
  if (created.status !== "saved") fail(`Stafettklassen kunde inte skapas (${created.status}).`);
  const classId = created.response.classId;
  for (let team = 0; team < TEAMS; team += 1) {
    const requestId = randomUUID();
    const result = await registerRelayTeamAsAdmin(db, { ...proof, idempotencyKey: `relay-team:${requestId}`, request: { formatVersion: 1,
      requestId, classId, number: null, name: `${clubName(team)} ${1 + Math.floor(team / 150)}`, organisationName: clubName(team),
      runners: Array.from({ length: legs }, (_, leg) => ({ ...runnerName(team * legs + leg), organisationName: clubName(team),
        cardNumber: String(cardBase + team * legs + leg) })) } });
    if (result.status !== "saved") fail(`Laget kunde inte anmälas (${result.status}).`);
  }
  // Sträckorna i ordning: varje sträckas måltid är nästa sträckas växling.
  const byEntry = await controlsByEntry(db, proof.raceId);
  const legRows = (await pool.query<{ id: string; team_id: string; relay_leg: number; given_name: string; family_name: string }>(
    "select id, team_id, relay_leg, given_name, family_name from entry where race_id = $1 and team_id is not null order by team_id, relay_leg",
    [proof.raceId])).rows;
  const runsByLeg: PlannedRun[][] = Array.from({ length: legs }, () => []);
  let previousTeam = "", clock = massStart.getTime();
  for (const row of legRows) {
    if (row.team_id !== previousTeam) { previousTeam = row.team_id; clock = massStart.getTime(); }
    const entry = byEntry.get(row.id)!;
    const finish = clock + (legMinutes[0] + rng() * (legMinutes[1] - legMinutes[0])) * MINUTE;
    runsByLeg[row.relay_leg - 1]!.push({ cardNumber: Number(entry.card), startAt: new Date(clock), finishAt: new Date(finish),
      controlCodes: entry.controls, name: `${row.given_name} ${row.family_name}` });
    clock = finish;
  }
  const preread = runsByLeg.slice(0, legsRead).flatMap((runs) => runs.sort((a, b) => a.finishAt.getTime() - b.finishAt.getTime()));
  const perReadout = await ingestDirect(db, proof, pool, preread, name);
  return { raceId: proof.raceId, shortCode, pending: runsByLeg[legsRead]!.sort((a, b) => a.finishAt.getTime() - b.finishAt.getTime()),
    extra: { classId, legsRead: String(legsRead), prereadMsPerReadout: perReadout.toFixed(1) } };
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? fail("Sätt DATABASE_URL till lasttestets databas.");
  if (process.env.NODE_ENV === "production") fail("Lasttestets data skapas inte i produktion.");
  const database = createDatabase(url);
  try {
    await migrate(database.db, { migrationsFolder: new URL("../../packages/database/migrations", import.meta.url).pathname });
    const owner = await account(database.db);
    const started = Date.now();
    const previous = existsSync(args.out) ? JSON.parse(readFileSync(args.out, "utf8")) as { races: Record<string, RacePlan> } : undefined;
    const races: Record<string, RacePlan> = { ...previous?.races };
    if (ONLY.has("individual")) {
      process.stdout.write(`Skapar ${RUNNERS} löpare i ${CLASSES} klasser …\n`);
      races.individual = await individual(database.db, database.pool, owner);
    }
    if (ONLY.has("relay3")) {
      process.stdout.write(`Skapar stafett ${TEAMS} lag × 3 …\n`);
      races.relay3 = await relay(database.db, database.pool, owner, "Lasttest stafett", 3, [25, 45], 8_400_001, true);
    }
    if (ONLY.has("relay25")) {
      process.stdout.write(`Skapar stafett ${TEAMS} lag × 25 …\n`);
      races.relay25 = await relay(database.db, database.pool, owner, "Lasttest 25-manna", 25, [5, 9], 8_500_001, false,
        Number(args["relay25-legs-read"] ?? 24));
    }
    const manifest = { createdAt: new Date().toISOString(), email: EMAIL, password: PASSWORD, small: SMALL, races };
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(manifest));
    process.stdout.write(`Klart på ${((Date.now() - started) / 1000).toFixed(0)} s. Manifest: ${args.out}\n`);
    for (const [key, race] of Object.entries(races)) process.stdout.write(`  ${key}: /t/${race.shortCode} (${race.pending.length} avläsningar kvar)\n`);
  } finally {
    await database.pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${describe(error)}\n`);
  process.exitCode = 1;
});
