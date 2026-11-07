/**
 * `pnpm load-test -- --base <url> [val]` – belastningstest för "hur många samtidiga arrangemang klarar servern" (ADR-0216,
 * docs/drift.md, Belastningstest). Bara Node (fetch); inget att installera på servern, körs från en annan dator.
 *
 * Skriptet skapar N tävlingar med ett konto (påhittade löpare, en bana och en klass), publicerar dem och kör sedan samtidigt per
 * tävling i M minuter:
 *   - avläsningar: R per minut till samma API som avläsningssidan (SPORTident-avläsning, simulerad),
 *   - publiken: V besökare som hämtar resultatlistan (eller Live) var femte sekund och laddar om sidan varje minut,
 *   - speakern: S skärmar (inloggade) som hämtar speakerlistan och Kvar i skogen var tionde sekund.
 * Sedan skrivs svarstider (p50/p95/p99) och fel per slags anrop, och tävlingarna tas bort (utom med --keep).
 *
 *   LOADTEST_EMAIL=… LOADTEST_PASSWORD=… pnpm load-test -- --base https://tid.exempelklubb.se --races 3 --minutes 5
 *   pnpm load-test -- --base http://127.0.0.1:3000 --register --races 2 --minutes 2     (lokalt, utan e-post på servern)
 *
 * Kontot ska vara ett vanligt konto (inte ditt eget med riktiga tävlingar behövs inte; tävlingarna tas bort efteråt).
 * Endast påhittade namn. Kör inte på en tävlingsdag.
 */
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({ options: {
  base: { type: "string", default: "http://127.0.0.1:3000" },
  races: { type: "string", default: "2" },
  minutes: { type: "string", default: "3" },
  runners: { type: "string", default: "150" },
  "readouts-per-minute": { type: "string", default: "20" },
  visitors: { type: "string", default: "30" },
  speakers: { type: "string", default: "1" },
  register: { type: "boolean", default: false },
  keep: { type: "boolean", default: false },
  out: { type: "string", default: "" }
} });

const base = args.base.replace(/\/$/, "");
const origin = new URL(base).origin;
const RACES = Math.max(1, Number(args.races));
const MINUTES = Math.max(0.25, Number(args.minutes));
const RUNNERS = Math.max(1, Number(args.runners));
const READOUTS_PER_MINUTE = Math.max(0, Number(args["readouts-per-minute"]));
const VISITORS = Math.max(0, Number(args.visitors));
const SPEAKERS = Math.max(0, Number(args.speakers));
const CONTROLS = [31, 32, 33, 34, 35, 36, 37, 38, 39, 40];
const TIME_ZONE = "Europe/Stockholm";

// ---- Mätningen

type Sample = { label: string; ms: number; ok: boolean; status: number };
const samples: Sample[] = [];
let measuring = false;

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p / 100 * sorted.length) - 1))]!;
}

export function summarize(rows: readonly Sample[], seconds: number) {
  const groups = new Map<string, Sample[]>();
  for (const row of rows) groups.set(row.label, [...groups.get(row.label) ?? [], row]);
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([label, list]) => {
    const sorted = list.map(row => row.ms).sort((a, b) => a - b);
    const statuses = [...new Set(list.filter(row => !row.ok).map(row => row.status))];
    return { label, count: list.length, errors: list.filter(row => !row.ok).length, errorStatuses: statuses, perSecond: list.length / seconds,
      p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99), max: sorted.at(-1) ?? Number.NaN };
  });
}

export function table(rows: ReturnType<typeof summarize>): string {
  const ms = (value: number) => Number.isNaN(value) ? "–" : value.toFixed(0);
  return ["| Anrop | antal | per s | fel | p50 ms | p95 ms | p99 ms | max ms |", "|---|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map(row => `| ${row.label} | ${row.count} | ${row.perSecond.toFixed(1)} | ${row.errors}` +
      `${row.errorStatuses.length ? ` (${row.errorStatuses.join(", ")})` : ""} | ${ms(row.p50)} | ${ms(row.p95)} | ${ms(row.p99)} | ${ms(row.max)} |`)].join("\n");
}

// ---- HTTP som en webbläsare: kakor, Origin och CSRF på skrivande anrop

class Browser {
  private readonly cookies = new Map<string, string>();
  async request(label: string | null, path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {})
    : Promise<{ status: number; json: unknown }> {
    const method = init.method ?? "GET";
    const headers: Record<string, string> = { "user-agent": "otid-load-test", ...init.headers };
    const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    if (cookie) headers.cookie = cookie;
    if (method !== "GET") {
      headers.origin = origin;
      headers["content-type"] = "application/json";
      const csrf = [...this.cookies].find(([name]) => name.endsWith("csrf"))?.[1];
      if (csrf) headers["x-otid-csrf"] = csrf;
    }
    const started = performance.now();
    let status = 0, json: unknown = null;
    try {
      const response = await fetch(`${base}${path}`, { method, headers, redirect: "manual", signal: AbortSignal.timeout(30_000),
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
      status = response.status;
      for (const line of response.headers.getSetCookie()) {
        const [pair] = line.split(";");
        const index = pair!.indexOf("=");
        this.cookies.set(pair!.slice(0, index).trim(), pair!.slice(index + 1).trim());
      }
      const text = await response.text();
      if ((response.headers.get("content-type") ?? "").includes("json")) { try { json = JSON.parse(text); } catch { json = null; } }
    } catch { status = 0; }
    if (label && measuring) samples.push({ label, ms: performance.now() - started, ok: status >= 200 && status < 400, status });
    return { status, json };
  }
}

const fail = (message: string): never => { throw new Error(message); };
async function must(browser: Browser, what: string, path: string, init: Parameters<Browser["request"]>[2], ok = [200, 201]) {
  const reply = await browser.request(null, path, init);
  if (!ok.includes(reply.status)) fail(`${what} misslyckades (${reply.status}): ${JSON.stringify(reply.json)?.slice(0, 300)}`);
  return reply.json as Record<string, unknown>;
}

// ---- Förberedelsen

const today = new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const GIVEN = ["Alva", "Bertil", "Cecilia", "Dag", "Ebba", "Folke", "Greta", "Hampus", "Ines", "Jarl", "Karin", "Lage"];
const FAMILY = ["Ask", "Björk", "Dahl", "Ek", "Fors", "Gran", "Hägg", "Lind", "Myr", "Näs", "Pil", "Rönn", "Tall", "Vass"];

type Race = { raceId: string; eventName: string; cards: string[] };

async function signIn(admin: Browser): Promise<void> {
  if (args.register) {
    const email = `lasttest.${randomUUID().slice(0, 8)}@example.com`;
    const reply = await admin.request(null, "/api/organizer/register", { method: "POST",
      body: { formatVersion: 1, email, displayName: "Lasttest", password: `lasttest-${randomUUID()}` } });
    if (reply.status !== 201 && reply.status !== 200) fail(`Registreringen misslyckades (${reply.status}); på en server med e-post: använd LOADTEST_EMAIL och LOADTEST_PASSWORD`);
    const session = await admin.request(null, "/api/organizer/events");
    if (session.status !== 200) fail("Registreringen loggade inte in (servern har e-post: använd ett befintligt konto med LOADTEST_EMAIL och LOADTEST_PASSWORD)");
    return;
  }
  const email = process.env.LOADTEST_EMAIL, password = process.env.LOADTEST_PASSWORD;
  if (!email || !password) fail("Sätt LOADTEST_EMAIL och LOADTEST_PASSWORD (ett konto på servern), eller --register lokalt");
  await must(admin, "Inloggningen", "/api/organizer/login", { method: "POST", body: { formatVersion: 1, email, password } });
}

async function createRace(admin: Browser, index: number): Promise<Race> {
  const eventName = `Lasttest ${new Date().toISOString().slice(0, 16)} nr ${index + 1}`;
  const created = await must(admin, "Ny tävling", "/api/organizer/events", { method: "POST",
    headers: { "idempotency-key": `organizer-event-create:${randomUUID()}` },
    body: { formatVersion: 1, eventName, raceName: "Lasttest", raceDate: today, timeZone: TIME_ZONE, raceType: "STANDARD" } });
  const raceId = String(created.raceId);
  const admin_ = `/api/admin/races/${raceId}/administrator`;
  const requestId = randomUUID();
  const course = await must(admin, "Ny bana och klass", `${admin_}/course-classes`, { method: "POST",
    headers: { "idempotency-key": `manual-course-class-create:${requestId}` },
    body: { formatVersion: 1, requestId, courseName: "Lång", className: "Öppen", startRule: "PUNCH", controlCodes: CONTROLS } });
  const cards: string[] = [];
  for (let runner = 0; runner < RUNNERS; runner += 1) {
    const cardNumber = String(7_000_000 + index * 10_000 + runner);
    await must(admin, "Anmälan", `${admin_}/registration`, { method: "POST", headers: { "idempotency-key": `entry-registration:${randomUUID()}` },
      body: { formatVersion: 1, classId: course.classId, expectedCourseVersionId: course.courseVersionId, expectedStartRule: "PUNCH",
        givenName: GIVEN[runner % GIVEN.length], familyName: `${FAMILY[Math.floor(runner / GIVEN.length) % FAMILY.length]} ${runner + 1}`,
        organisationName: "OK Lasttest", cardNumber, fixedStartTime: null } });
    cards.push(cardNumber);
  }
  await must(admin, "Publiceringen", `${admin_}/race-publication`, { method: "PUT" });
  return { raceId, eventName, cards };
}

// ---- Lasten

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function readoutPayload(cardNumber: string, finishAt: Date) {
  const startAt = new Date(finishAt.getTime() - (25 + Math.random() * 20) * 60_000);
  const step = (finishAt.getTime() - startAt.getTime()) / (CONTROLS.length + 1);
  // Fälten i kontraktets ordning: servern räknar hashen över den tolkade nyttolasten.
  return { cardNumber, cardType: "SI9", startPunchedAt: startAt.toISOString(), finishPunchedAt: finishAt.toISOString(),
    punches: CONTROLS.map((code, index) => ({ code, punchedAt: new Date(startAt.getTime() + (index + 1) * step).toISOString() })),
    untimedPunchCodes: [], frames: ["02ef0100"], simulated: true };
}

async function readoutStation(station: Browser, race: Race, until: number): Promise<void> {
  if (READOUTS_PER_MINUTE <= 0) return;
  const deviceId = randomUUID();
  const gap = 60_000 / READOUTS_PER_MINUTE;
  let sequence = 0;
  await sleep(Math.random() * gap);
  while (Date.now() < until && sequence < race.cards.length) {
    const payload = readoutPayload(race.cards[sequence]!, new Date(Date.now() - 10_000));
    sequence += 1;
    void station.request("avläsning (kvitto)", `/api/admin/races/${race.raceId}/administrator/readouts`, { method: "POST",
      body: { deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: sequence, lastSequence: sequence, events: [{ localSequence: sequence,
        stationReceivedAt: new Date().toISOString(), transport: "sportident", payload,
        contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }] } });
    await sleep(gap * (0.5 + Math.random()));
  }
}

async function visitor(race: Race, index: number, until: number): Promise<void> {
  const browser = new Browser();
  const live = index % 3 === 2;
  await sleep(Math.random() * 5_000);
  let lastPage = 0;
  while (Date.now() < until) {
    if (Date.now() - lastPage >= 60_000) {
      lastPage = Date.now();
      await browser.request("publiken: resultatsidan (HTML)", `/results/${race.raceId}`);
    }
    await browser.request(live ? "publiken: Live (API)" : "publiken: resultatlistan (API)",
      live ? `/api/public/races/${race.raceId}/live` : `/api/public/races/${race.raceId}/results`);
    await sleep(5_000);
  }
}

async function speaker(screen: Browser, race: Race, until: number): Promise<void> {
  await sleep(Math.random() * 10_000);
  while (Date.now() < until) {
    await Promise.all([
      screen.request("speaker: speakerlistan", `/api/admin/races/${race.raceId}/administrator/speaker-board`),
      screen.request("speaker: kvar i skogen", `/api/admin/races/${race.raceId}/administrator/forest-watch`)
    ]);
    await sleep(10_000);
  }
}

async function main(): Promise<void> {
  const admin = new Browser();
  process.stdout.write(`Mot ${base}: ${RACES} tävlingar × ${RUNNERS} löpare, ${READOUTS_PER_MINUTE} avläsningar/min, ${VISITORS} besökare och ` +
    `${SPEAKERS} speaker per tävling i ${MINUTES} min.\n`);
  await signIn(admin);
  const races: Race[] = [];
  try {
    for (let index = 0; index < RACES; index += 1) {
      races.push(await createRace(admin, index));
      process.stdout.write(`Tävling ${index + 1} klar (${RUNNERS} anmälda, publicerad).\n`);
    }
    measuring = true;
    const started = Date.now();
    const until = started + MINUTES * 60_000;
    const work: Promise<void>[] = [];
    for (const race of races) {
      work.push(readoutStation(admin, race, until));
      for (let index = 0; index < VISITORS; index += 1) work.push(visitor(race, index, until));
      for (let index = 0; index < SPEAKERS; index += 1) work.push(speaker(admin, race, until));
    }
    const progress = setInterval(() => process.stdout.write(`… ${Math.round((Date.now() - started) / 1000)} s, ${samples.length} anrop\n`), 30_000);
    await Promise.all(work);
    await sleep(2_000);
    clearInterval(progress);
    measuring = false;
    const seconds = (Date.now() - started) / 1000;
    const rows = summarize(samples, seconds);
    const errors = samples.filter(sample => !sample.ok).length;
    process.stdout.write(`\n${table(rows)}\n\n${samples.length} anrop på ${seconds.toFixed(0)} s (${(samples.length / seconds).toFixed(1)} per s), ` +
      `${errors} fel (${(errors / Math.max(1, samples.length) * 100).toFixed(1)} %). Status 0 = inget svar inom 30 s; 503 = publiken avlastas.\n`);
    if (args.out) writeFileSync(args.out, JSON.stringify({ base, races: RACES, minutes: MINUTES, runners: RUNNERS,
      readoutsPerMinute: READOUTS_PER_MINUTE, visitors: VISITORS, speakers: SPEAKERS, seconds, rows }, null, 2));
  } finally {
    if (!args.keep) {
      for (const race of races) {
        const reply = await admin.request(null, `/api/organizer/races/${race.raceId}/delete`, { method: "POST",
          body: { formatVersion: 1, confirmation: race.eventName } });
        if (reply.status !== 200) process.stderr.write(`Tävlingen "${race.eventName}" kunde inte tas bort (${reply.status}); ta bort den i Mina tävlingar.\n`);
      }
      if (races.length) process.stdout.write(`${races.length} lasttesttävlingar borttagna.\n`);
    }
  }
}

if (process.argv[1] && /load-test\.ts$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
