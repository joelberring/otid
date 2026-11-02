import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { type DeviceBatch, type SportidentReadoutPayload } from "@o-tid/contracts";
import { BUILT_IN_PRINT_PROFILES, readPpen, type CourseSettingDocument } from "@o-tid/course-setting";
import { FONT_FILE_NAMES, FONT_VARIANTS, type FontFiles } from "@o-tid/print-pdf";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { importCourseSettingAsAdmin, readCourseSettingAsAdmin } from "../../src/course-setting";
import {
  claimPrintJob, cleanupPrintJobs, createPrintJobAsAdmin, deletePrintJobAsAdmin, listPrintJobsAsAdmin, PRINT_JOB_LIMITS, readPrintJobPdfAsAdmin, runPrintJob
} from "../../src/course-setting-print";
import { createManualCourseClassAsAdmin } from "../../src/manual-course-class";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { ingestReadoutsAsAdmin } from "../../src/readout-station";
import { contentHash } from "../../src/serialization";
import { accountOnRace, grantRacePerson, raceAuth, registerTestAccount } from "./accounts";

/**
 * Steg 65 (ADR-0184, ADR-0177): PDF för tryck som jobb i en kö. Bara admin skapar, listar och laddar ned; samma
 * requestId ger samma jobb; högst tre aktiva per tävling; profiler som kräver PDF/X stoppas; arbetaren tar jobben
 * (SKIP LOCKED), skriver PDF:en med dekorfärgen och sparar den; rensningen tar gamla PDF:er; och en avläsning görs medan
 * arbetaren (egen process, nice 19) skriver en stor PDF utan att vänta på den.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Steg 65-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_steg65_tryck_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const fixtures = new URL("../../../../fixtures/", import.meta.url);
const fontDir = new URL("../../../print-pdf/fonts/", import.meta.url);
let fonts: FontFiles;

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
  fonts = Object.fromEntries(await Promise.all(FONT_VARIANTS.map(async variant =>
    [variant, new Uint8Array(await readFile(new URL(FONT_FILE_NAMES[variant], fontDir)))]))) as unknown as FontFiles;
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_steg65_tryck_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };

async function race(): Promise<Proof & { accountProof: Omit<Proof, "raceId"> }> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `tryck.${suffix}@test.o-tid.se`, displayName: "Tor Tryck", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Tryck", raceName: "Torsdag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const raceId = created.response.raceId;
  const entered = await accountOnRace(db, { ...accountProof, raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  const proof = { raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
  const ppen = await readFile(new URL("course-setting/kartfil.ppen", fixtures), "utf8");
  const imported = await importCourseSettingAsAdmin(db, { ...proof, request: { formatVersion: 1, expectedVersion: 0, document: readPpen(ppen).document,
    fileName: "kartfil.ppen", ppen } });
  if (imported.status !== "ok") throw new Error("Inläsningen misslyckades");
  // Kartfilen (OCAD) direkt i tabellen; uppladdningen provas i steg 59.
  const file = await readFile(new URL("maps/kartfil.ocd", fixtures));
  await db.insert(schema.raceMapSources).values({ raceId, fileName: "kartfil.ocd", format: "OCD", version: "OCAD 2018.0", file, sha256: "0".repeat(64),
    byteLength: file.byteLength, scale: 10000, bounds: { minX: -10, minY: -10, maxX: 110, maxY: 90 }, georeference: null,
    render: { originX: -10, originY: 90, pxPerMm: 1 }, summary: { objectCount: 11, warnings: [], simplifications: [] }, uploadedAt: new Date() });
  return { ...proof, accountProof };
}

async function document(proof: Proof): Promise<CourseSettingDocument> {
  const read = await readCourseSettingAsAdmin(db, proof);
  if (read.status !== "ok" || !read.response.setting) throw new Error("Läget saknas");
  return read.response.setting.document as unknown as CourseSettingDocument;
}

function request(courses: readonly string[], overrides: Record<string, unknown> = {}) {
  return { formatVersion: 1, requestId: randomUUID(), kind: "PRESS", profileId: "as-file", layout: { kind: "PAGES", header: true }, perRunner: false,
    duplex: false, items: courses.map(course => ({ course })), warningsConfirmed: false, ...overrides };
}

async function work(worker = "test-worker") {
  const job = await claimPrintJob(db, worker);
  if (!job) throw new Error("Inget jobb i kön");
  return { job, outcome: await runPrintJob(db, job, { fonts, worker }) };
}

const CODES = [31, 32, 33];

async function readout(proof: Proof, cardNumber: string): Promise<number> {
  const payload: SportidentReadoutPayload = { cardNumber, cardType: "SI10", finishPunchedAt: "2026-10-08T17:40:00.000Z",
    punches: CODES.map((code, index) => ({ code, punchedAt: `2026-10-08T17:${String(10 + index * 10)}:00.000Z` })),
    untimedPunchCodes: [], frames: ["02ef8300"], stationSerial: 999001, simulated: true };
  const version = (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [proof.raceId])).rows[0]!.snapshot_version;
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: version, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-10-08T17:41:00.000Z", transport: "sportident", payload, contentHash: contentHash(payload) }] };
  const started = performance.now();
  const ingested = await ingestReadoutsAsAdmin(db, { ...proof, batch });
  const ms = performance.now() - started;
  if (ingested.status !== "ok" || ingested.response.acknowledgements[0]?.status !== "stored") throw new Error("Avläsningen togs inte emot");
  return ms;
}

const status = async (id: string) => (await pool.query<{ status: string }>("select status from course_setting_print_job where id = $1", [id])).rows[0]?.status;

describe("steg 65: PDF för tryck på servern", { timeout: 240_000 }, () => {
  it("kön: admin skapar och listar, samma requestId ger samma jobb, högst tre aktiva, PDF/X stoppas, andra får inte", async () => {
    const owner = await race();
    const doc = await document(owner);
    const courseIds = doc.courses.map(course => course.id);
    const first = request(courseIds);
    const created = await createPrintJobAsAdmin(db, { ...owner, request: first });
    expect(created).toMatchObject({ status: "ok", created: true, job: { status: "QUEUED", kind: "PRESS" } });
    const again = await createPrintJobAsAdmin(db, { ...owner, request: first });
    expect(again).toMatchObject({ status: "ok", created: false });
    if (created.status !== "ok" || again.status !== "ok") throw new Error("inget jobb");
    expect(again.job.id).toBe(created.job.id);
    const listed = await listPrintJobsAsAdmin(db, owner);
    expect(listed.status === "ok" && listed.response.jobs.map(job => [job.id, job.status, job.position])).toEqual([[created.job.id, "QUEUED", 1]]);
    // Inte klar än: ingen PDF.
    expect(await readPrintJobPdfAsAdmin(db, { ...owner, jobId: created.job.id })).toEqual({ status: "not-found" });
    // Ogiltigt: okänd profil, trasig mall, för många kartor.
    expect(await createPrintJobAsAdmin(db, { ...owner, request: request(courseIds, { profileId: "finns-inte" }) })).toMatchObject({ status: "problem", problem: { problem: "INVALID_PROFILE" } });
    expect(await createPrintJobAsAdmin(db, { ...owner, request: request(courseIds, { layout: { kind: "TEMPLATE", template: { schemaVersion: 9 }, fill: "FILL" } }) }))
      .toMatchObject({ status: "problem", problem: { problem: "INVALID_TEMPLATE" } });
    expect((await createPrintJobAsAdmin(db, { ...owner, request: request(Array.from({ length: 2001 }, () => courseIds[0]!)) })).status).toBe("invalid-request");
    // En profil som kräver PDF/X stoppas: PDF:en kan inte det (inte verifierat).
    const pdfX = { ...BUILT_IN_PRINT_PROFILES[0]!, id: "pdfx", name: "Kräver PDF/X", requirements: { pdfX: true, icc: false, trueOverprint: true } };
    expect(await createPrintJobAsAdmin(db, { ...owner, request: request(courseIds, { profileId: "pdfx", profile: pdfX }) }))
      .toMatchObject({ status: "problem", problem: { problem: "PREFLIGHT_BLOCKED" } });
    // Högst tre aktiva jobb per tävling.
    for (let index = 0; index < PRINT_JOB_LIMITS.activePerRace - 1; index += 1) {
      expect((await createPrintJobAsAdmin(db, { ...owner, request: request(courseIds) })).status).toBe("ok");
    }
    expect(await createPrintJobAsAdmin(db, { ...owner, request: request(courseIds) })).toMatchObject({ status: "problem", problem: { problem: "TOO_MANY_JOBS" } });

    // Banläggare med EDIT och funktionärer får inte: bara admin.
    const editor = await registerTestAccount(db);
    const granted = await grantRacePerson(db, owner.accountProof, owner.raceId, editor.email, "COURSE_EDIT" as never);
    expect(granted.status).toBe("granted");
    const editorProof = { raceId: owner.raceId, ...editor.proof };
    expect((await listPrintJobsAsAdmin(db, editorProof)).status).toBe("forbidden");
    expect((await createPrintJobAsAdmin(db, { ...editorProof, request: request(courseIds) })).status).toBe("forbidden");
    expect((await readPrintJobPdfAsAdmin(db, { ...editorProof, jobId: created.job.id })).status).toBe("forbidden");
    const functionary = await raceAuth(db, owner.raceId, "FUNCTIONARY");
    expect((await listPrintJobsAsAdmin(db, functionary)).status).toBe("forbidden");
    // En annan administratör på eventet får.
    const secondAdmin = await raceAuth(db, owner.raceId, "ADMIN");
    expect((await listPrintJobsAsAdmin(db, secondAdmin)).status).toBe("ok");
    const stranger = await registerTestAccount(db);
    const strangerProof = { raceId: owner.raceId, ...stranger.proof };
    expect((await listPrintJobsAsAdmin(db, strangerProof)).status).toMatch(/forbidden|unauthorized/);
    expect((await createPrintJobAsAdmin(db, { ...strangerProof, request: request(courseIds) })).status).toMatch(/forbidden|unauthorized/);
    expect((await readPrintJobPdfAsAdmin(db, { ...strangerProof, jobId: created.job.id })).status).toMatch(/forbidden|unauthorized/);
    expect((await deletePrintJobAsAdmin(db, { ...strangerProof, jobId: created.job.id })).status).toMatch(/forbidden|unauthorized/);
    // En annan tävlings admin når inte jobbet.
    const other = await race();
    expect(await readPrintJobPdfAsAdmin(db, { ...other, jobId: created.job.id })).toEqual({ status: "not-found" });
    expect(await deletePrintJobAsAdmin(db, { ...other, jobId: created.job.id })).toEqual({ status: "not-found" });
    await pool.query("delete from course_setting_print_job");
  });

  it("arbetaren: tar jobbet, skriver PDF:en med lilan som dekorfärg och övertryck; ett borttaget jobb slängs", async () => {
    const owner = await race();
    const doc = await document(owner);
    const created = await createPrintJobAsAdmin(db, { ...owner, request: request(doc.courses.map(course => course.id)) });
    if (created.status !== "ok") throw new Error("inget jobb");
    // Två arbetare tar aldrig samma jobb.
    const [one, two] = await Promise.all([claimPrintJob(db, "a"), claimPrintJob(db, "b")]);
    expect([one, two].filter(Boolean)).toHaveLength(1);
    const claimed = (one ?? two)!;
    expect(await runPrintJob(db, claimed, { fonts, worker: one ? "a" : "b" })).toBe("DONE");
    const listed = await listPrintJobsAsAdmin(db, owner);
    if (listed.status !== "ok") throw new Error("listan");
    expect(listed.response.jobs[0]).toMatchObject({ status: "DONE", pages: doc.courses.length, plates: ["Purple"], overprint: true });
    const pdf = await readPrintJobPdfAsAdmin(db, { ...owner, jobId: created.job.id });
    if (pdf.status !== "ok") throw new Error("ingen PDF");
    const text = Buffer.from(pdf.pdf).toString("latin1");
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text).toMatch(/\/Separation \/Purple \/DeviceCMYK/);
    expect(text).toMatch(/\/OP true\s+\/op true\s+\/OPM 1/);
    expect(pdf.fileName).toMatch(/^banor-tryck-\d{8}-\d{4}\.pdf$/);

    // Kontorsskrivaren: inga dekorfärger.
    const office = await createPrintJobAsAdmin(db, { ...owner, request: request([doc.courses[0]!.id], { kind: "OFFICE", profileId: "office" }) });
    if (office.status !== "ok") throw new Error("inget jobb");
    expect((await work()).outcome).toBe("DONE");
    const officePdf = await readPrintJobPdfAsAdmin(db, { ...owner, jobId: office.job.id });
    expect(officePdf.status === "ok" && Buffer.from(officePdf.pdf).toString("latin1")).not.toMatch(/\/Separation/);

    // Borttaget medan det körs: arbetaren sparar inget.
    const gone = await createPrintJobAsAdmin(db, { ...owner, request: request([doc.courses[0]!.id]) });
    if (gone.status !== "ok") throw new Error("inget jobb");
    const job = await claimPrintJob(db, "c");
    expect(await deletePrintJobAsAdmin(db, { ...owner, jobId: gone.job.id })).toEqual({ status: "ok" });
    expect(await runPrintJob(db, job!, { fonts, worker: "c" })).toBe("GONE");

    // Ett jobb som inte går att skriva (okänd bana) blir FAILED med texten.
    const bad = await createPrintJobAsAdmin(db, { ...owner, request: request(["finns-inte"]) });
    if (bad.status !== "ok") throw new Error("inget jobb");
    expect((await work()).outcome).toBe("FAILED");
    const failed = await listPrintJobsAsAdmin(db, owner);
    expect(failed.status === "ok" && failed.response.jobs.find(row => row.id === bad.job.id)?.error).toMatch(/finns inte/);
    // Storleksgränsen: en PDF över gränsen sparas inte.
    await createPrintJobAsAdmin(db, { ...owner, request: request([doc.courses[0]!.id]) });
    const small = await claimPrintJob(db, "d");
    expect(await runPrintJob(db, small!, { fonts, worker: "d", maxBytes: 1000 })).toBe("FAILED");
    await pool.query("delete from course_setting_print_job");
  });

  it("rensning: gamla PDF:er tas bort, högst tio per tävling, gamla rader försvinner; ett avbrutet jobb görs om", async () => {
    const owner = await race();
    const doc = await document(owner);
    // Sessionen skapas med verklig tid; en fast tid före den gav "unauthorized" från och med 2026-11-02 12:00 UTC.
    const now = new Date(Date.now() + 60_000);
    const ids: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const created = await createPrintJobAsAdmin(db, { ...owner, request: request([doc.courses[0]!.id]) }, now);
      if (created.status !== "ok") throw new Error(`jobb ${index}`);
      ids.push(created.job.id);
      await pool.query("update course_setting_print_job set status = 'DONE', pdf = '\\x255044462d'::bytea, byte_length = 5, finished_at = $2 where id = $1",
        [created.job.id, new Date(now.getTime() - (12 - index) * 3600_000)]);
    }
    await pool.query("update course_setting_print_job set finished_at = $2 where id = $1", [ids[11], new Date(now.getTime() - 8 * 24 * 3600_000)]);
    const cleaned = await cleanupPrintJobs(db, now);
    expect(cleaned.expired).toBe(2);
    const rows = await pool.query<{ id: string; status: string; has_pdf: boolean }>("select id, status, pdf is not null as has_pdf from course_setting_print_job");
    const done = rows.rows.filter(row => row.status === "DONE");
    expect(done).toHaveLength(10);
    expect(done.every(row => row.has_pdf)).toBe(true);
    expect(rows.rows.filter(row => row.status === "EXPIRED").map(row => [row.id, row.has_pdf]).sort())
      .toEqual([[ids[0], false], [ids[11], false]].sort());
    // Efter 30 dagar försvinner raderna.
    await pool.query("update course_setting_print_job set created_at = $1", [new Date(now.getTime() - 31 * 24 * 3600_000)]);
    expect((await cleanupPrintJobs(db, now)).deleted).toBe(12);

    // Ett pågående jobb utan livstecken görs om en gång, sedan blir det FAILED.
    const stuck = await createPrintJobAsAdmin(db, { ...owner, request: request([doc.courses[0]!.id]) }, now);
    if (stuck.status !== "ok") throw new Error("jobb");
    await claimPrintJob(db, "död", now);
    const later = new Date(now.getTime() + 20 * 60_000);
    const retried = await claimPrintJob(db, "ny", later);
    expect(retried).toMatchObject({ id: stuck.job.id, attempts: 2 });
    expect(await claimPrintJob(db, "tredje", new Date(later.getTime() + 20 * 60_000))).toBeUndefined();
    expect(await status(stuck.job.id)).toBe("FAILED");
    await pool.query("delete from course_setting_print_job");
  });

  it("en avläsning under ett pågående jobb väntar inte: arbetaren är en egen process med låg prioritet", async () => {
    const owner = await race();
    const doc = await document(owner);
    // En löpare att läsa av.
    const requestId = randomUUID();
    const course = await createManualCourseClassAsAdmin(db, { ...owner, idempotencyKey: `manual-course-class-create:${requestId}`,
      request: { formatVersion: 1, requestId, courseName: "Lång", className: "H21", startRule: "PUNCH", controlCodes: CODES } });
    if (course.status !== "created" || course.response.classId === null) throw new Error("Banan");
    const entered = await registerEntryAsAdmin(db, { ...owner, idempotencyKey: `entry-registration:${randomUUID()}`, request: { formatVersion: 1,
      classId: course.response.classId, expectedCourseVersionId: course.response.courseVersionId, expectedStartRule: "PUNCH", givenName: "Ada", familyName: "Lind",
      organisationName: "OK Tryck", cardNumber: "7300001", fixedStartTime: null } });
    if (entered.status !== "registered") throw new Error("Anmälan");
    // Ett stort jobb: 900 kartor per löpare med baksidor (1 800 sidor).
    const runners = Array.from({ length: 900 }, (_, index) => ({ course: doc.courses[0]!.id,
      runner: { kind: "RUNNER", name: `Löpare ${index}`, club: "OK", className: "H21", startTime: "18:00", startNumber: index + 1 } }));
    const big = await createPrintJobAsAdmin(db, { ...owner, request: request([], { items: runners, perRunner: true, duplex: true,
      layout: { kind: "TEMPLATE", template: "a4-one", fill: "FILL" } }) });
    if (big.status !== "ok") throw new Error(`jobbet: ${JSON.stringify(big)}`);
    const script = fileURLToPath(new URL("../../../../scripts/print-worker.ts", import.meta.url));
    const child = spawn(process.execPath, ["--import", "tsx", script, "--once"], { env: { ...process.env, DATABASE_URL: url.href }, stdio: "pipe" });
    let output = "";
    child.stdout.on("data", chunk => { output += String(chunk); });
    child.stderr.on("data", chunk => { output += String(chunk); });
    const exited = new Promise<number | null>(resolve => child.on("exit", resolve));
    // Vänta tills arbetaren tagit jobbet.
    const deadline = Date.now() + 60_000;
    while (await status(big.job.id) !== "RUNNING") {
      if (Date.now() > deadline) throw new Error(`Arbetaren tog aldrig jobbet: ${output}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const ms = await readout(owner, "7300001");
    // Avläsningen var klar medan PDF:en fortfarande skrevs, och snabbt.
    expect(await status(big.job.id)).toBe("RUNNING");
    expect(ms).toBeLessThan(2000);
    expect(await exited).toBe(0);
    expect(await status(big.job.id), output).toBe("DONE");
    const listed = await listPrintJobsAsAdmin(db, owner);
    expect(listed.status === "ok" && listed.response.jobs[0]?.pages).toBe(1800);
  });
});
