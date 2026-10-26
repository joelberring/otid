/**
 * Lasttestets lastgenerator (PLAN.md steg 51, docs/lasttest.md). Kör mot en körande webb (produktionsbygget) med
 * testdatan från seed.ts. Ett scenario per körning:
 *
 *   pnpm lasttest:load -- --manifest m.json --race individual --visitors 300 --readouts 300 --minutes 10 [--actions]
 *
 * - Målrusning: tre avläsningsdatorer (egna sessioner, sekvenser och köer) skickar avläsningar till samma API som
 *   avläsningssidan (POST …/administrator/readouts). Ankomsterna har toppar på 3 per sekund. "Besked" = tid från att
 *   brickan sätts i till att servern kvitterat (inklusive kö på datorn).
 * - Publiken: virtuella webbläsare öppnar en sida (resultat, Live, startlista, deltagare, tävlingssidan), håller
 *   resultatströmmen öppen och hämtar som sidorna gör: var femte sekund och direkt vid en händelse, aldrig två samtidigt.
 * - Speakern: två inloggade speakerskärmar (var tionde sekund och vid händelse).
 * - Funktionärsåtgärder (--actions): redigera den delade banan (> 300 avlästa) och tillbaka, flytta en klass
 *   starttider 2 min och tillbaka, och "Resultaten är klara" när rusningen är slut.
 * - Uppdatering till publiken: provbesökare letar efter varje kvitterad löpare i sina svar.
 * Resultatet skrivs som tabeller (Markdown) och JSON.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { readoutEvent } from "./common.ts";
import { averages, CgroupMeter, Client, percentile, Recorder, sleep, summarize, table } from "./measure.ts";

const { values: args } = parseArgs({ options: {
  base: { type: "string", default: "http://127.0.0.1:3000" },
  origin: { type: "string", default: "https://otid.lasttest" },
  manifest: { type: "string", default: "/tmp/otid-lasttest/manifest.json" },
  race: { type: "string", default: "individual" },
  visitors: { type: "string", default: "100" },
  readouts: { type: "string", default: "300" },
  minutes: { type: "string", default: "10" },
  devices: { type: "string", default: "3" },
  speakers: { type: "string", default: "2" },
  actions: { type: "boolean", default: false },
  cgroups: { type: "string", default: "" },
  out: { type: "string", default: "/tmp/otid-lasttest/result.json" },
  label: { type: "string", default: "" },
  /** Sidornas beteende i webbläsaren: new (steg 51) eller old (före steg 51, för mätningen före). */
  client: { type: "string", default: "new" }
} });

type Run = { cardNumber: number; startAt: string; finishAt: string; controlCodes: number[]; name: string };
type RacePlan = { raceId: string; shortCode: string; pending: Run[]; extra: Record<string, string> };
const manifest = JSON.parse(readFileSync(args.manifest, "utf8")) as { email: string; password: string; races: Record<string, RacePlan> };
const race = manifest.races[args.race] ?? (() => { throw new Error(`Tävlingen ${args.race} finns inte i manifestet`); })();
const raceId = race.raceId;
const recorder = new Recorder();
/** Flera webbinstanser (`--base a,b`): varje klient (webbläsare, avläsningsdator) håller sig till en, som bakom Caddy med lb. */
const bases = args.base.split(",");
let clients = 0;
const client = () => new Client(bases[clients++ % bases.length]!, args.origin, recorder);
const durationMs = Number(args.minutes) * 60_000;
const admin = `/api/admin/races/${raceId}/administrator`;
let stopping = false;

/** Ankomsttider: toppar på 3/s i 15 s varannan minut, resten jämnt utspritt (Poisson). */
function arrivals(count: number, spanMs: number): number[] {
  const peaks: number[] = [];
  for (let start = 30_000; start + 15_000 <= spanMs && peaks.length + 45 <= count * 0.75; start += 120_000) {
    for (let index = 0; index < 45; index += 1) peaks.push(start + index * 333);
  }
  const rest = count - peaks.length;
  const spread = Array.from({ length: rest }, (_, index) => (index + Math.random()) * spanMs / rest);
  return [...peaks, ...spread].sort((a, b) => a - b);
}

// ---- Uppdatering till publiken: när kvitterades löparen, när såg en provbesökare den?
const acked = new Map<string, number>();
const seen = new Map<string, number[]>();
function lookFor(text: string): void {
  const now = Date.now();
  for (const [name, at] of acked) {
    const [given, ...family] = name.split(" ");
    if (!text.includes(`"givenName":"${given}","familyName":"${family.join(" ")}"`)) continue;
    const list = seen.get(name) ?? [];
    list.push(now - at);
    seen.set(name, list);
  }
}
const probeNames = new Set<string>();

// ---- Avläsningsdatorerna
const beskedMs: number[] = [];
let devicesWithoutPackage = 0;
async function readoutDevice(index: number, runs: Run[], times: number[], startedAt: number): Promise<void> {
  const device = client();
  await device.login(manifest.email, manifest.password);
  // Som avläsningssidan: försöker igen tills paketet hämtats (en överbelastad server kan behöva flera försök).
  let pkg = await device.request("readout-package", `${admin}/readout-package`, { timeoutMs: 60_000 });
  for (let attempt = 1; pkg.status !== 200 && attempt < 3; attempt += 1) {
    await sleep(5_000);
    pkg = await device.request("readout-package", `${admin}/readout-package`, { timeoutMs: 60_000 });
  }
  if (pkg.status !== 200) {
    // Mätningen fortsätter: att avläsningsdatorn inte får paketet är resultatet (alla dess avläsningar räknas som utan kvitto).
    process.stdout.write(`  avläsningsdator ${index + 1}: paketet kunde inte hämtas på tre försök (${pkg.status})\n`);
    devicesWithoutPackage += 1;
    return;
  }
  let packageVersion = (JSON.parse(pkg.text()) as { packageVersion: number }).packageVersion;
  const deviceId = randomUUID(), sessionId = randomUUID();
  const queue: { run: Run; insertedAt: number; sequence: number }[] = [];
  let next = 0, sequence = 0;
  while (next < runs.length || queue.length > 0) {
    const now = Date.now() - startedAt;
    while (next < runs.length && times[next]! <= now) {
      queue.push({ run: runs[next]!, insertedAt: startedAt + times[next]!, sequence: ++sequence });
      next += 1;
    }
    if (queue.length === 0) { await sleep(Math.min(250, Math.max(10, times[next]! - now))); continue; }
    // Som avläsningskön: sammanhängande löpnummer, högst 100 per sats.
    const batch = queue.splice(0, 100);
    const readAt = new Date();
    const events = batch.map(({ run, sequence: localSequence }) => readoutEvent({ cardNumber: run.cardNumber, startAt: new Date(run.startAt),
      finishAt: new Date(readAt.getTime() - 60_000), controlCodes: run.controlCodes }, localSequence, readAt));
    const reply = await device.request(batch.length === 1 ? "readouts POST (1)" : "readouts POST (sats)", `${admin}/readouts`, { method: "POST",
      body: { deviceId, sessionId, packageVersion, firstSequence: batch[0]!.sequence, lastSequence: batch.at(-1)!.sequence, events } });
    if (reply.status !== 200) {
      queue.unshift(...batch);
      await sleep(1_000);
      continue;
    }
    const ack = JSON.parse(reply.text()) as { currentPackageVersion: number; packageUpdateRequired: boolean; acknowledgements: { status: string }[] };
    const doneAt = Date.now();
    for (const item of batch) { beskedMs.push(doneAt - item.insertedAt); acked.set(item.run.name, doneAt); }
    if (ack.acknowledgements.some((row) => row.status !== "stored" && row.status !== "duplicate")) {
      recorder.record({ label: "readouts ej sparad", ms: 0, ok: false, status: 200, bytes: 0, at: doneAt });
    }
    if (ack.packageUpdateRequired || ack.currentPackageVersion !== packageVersion) {
      const fresh = await device.request("readout-package", `${admin}/readout-package`, { timeoutMs: 60_000 });
      if (fresh.status === 200) packageVersion = (JSON.parse(fresh.text()) as { packageVersion: number }).packageVersion;
    }
  }
  process.stdout.write(`  avläsningsdator ${index + 1}: ${runs.length} avläsningar klara\n`);
}

// ---- Publiken
type Page = { name: string; html: string; reads: string[]; stream: boolean; interval: number };
/**
 * En besökare som sidans kod i webbläsaren. `--client new` (steg 51): väckningar samlas och sprids (3 s mellan, 0–1 s
 * slump), egen hämtning bara var 15:e sekund medan strömmen är öppen, och resultatsidan hämtar stafett och radio bara
 * när de har innehåll (annars var 30:e sekund). `--client old` (före steg 51): hämtar direkt vid varje väckning och var
 * femte sekund, alla tre listorna varje gång.
 */
async function visitor(index: number, pages: Page[], participantIds: string[]): Promise<void> {
  const browser = client();
  const page = pages[index % pages.length]!;
  const probe = index < 24 && (page.name === "resultat" || page.name === "live");
  const pid = participantIds[index % Math.max(1, participantIds.length)] ?? "";
  const reads = page.reads.map((path) => path.replace("{pid}", pid));
  const paced = args.client === "new";
  await browser.request(`sida ${page.name}`, page.html.replace("{pid}", pid));
  let running = false, streamOpen = false, lastFetch = 0, sideAt = Number.NEGATIVE_INFINITY, sideHasContent = false;
  const side = (path: string) => /\/(relay-results|radio)$/.test(path) && page.name === "resultat";
  const refresh = async (): Promise<void> => {
    if (running) return;
    running = true;
    lastFetch = Date.now();
    const sideDue = !paced || sideHasContent || Date.now() - sideAt >= 30_000;
    if (sideDue) sideAt = Date.now();
    try {
      const replies = await Promise.all(reads.filter((path) => !side(path) || sideDue).map(async (path) => {
        const reply = await browser.request(`GET ${label(path)}`, path);
        if (side(path) && reply.status === 200) sideHasContent ||= /"classes":\[\{|"enabled":true/.test(reply.text());
        return reply;
      }));
      if (probe) for (const reply of replies) if (reply.status === 200) lookFor(reply.text());
    } finally { running = false; }
  };
  let wakeTimer: ReturnType<typeof setTimeout> | undefined, lastWake = Number.NEGATIVE_INFINITY;
  const wake = () => {
    if (!paced) { void refresh(); return; }
    if (wakeTimer) return;
    const delay = Math.max(0, lastWake + 3_000 - Date.now()) + Math.random() * 1_000;
    wakeTimer = setTimeout(() => { wakeTimer = undefined; lastWake = Date.now(); void refresh(); }, delay);
  };
  if (probe) probeNames.add(`${page.name}-${index}`);
  const close = page.stream ? browser.stream(`/api/public/races/${raceId}/result-events`, wake, (ms, ok) => {
    streamOpen = ok;
    recorder.record({ label: "SSE öppna", ms, ok, status: ok ? 200 : 0, bytes: 0, at: Date.now() });
  }) : () => undefined;
  await sleep(Math.random() * page.interval);
  // Laddar om sidan ungefär varannan minut.
  let reloadAt = Date.now() + 60_000 + Math.random() * 120_000;
  while (!stopping) {
    if (Date.now() >= reloadAt) {
      reloadAt = Date.now() + 60_000 + Math.random() * 120_000;
      void browser.request(`sida ${page.name}`, page.html.replace("{pid}", pid));
    }
    if (!paced || !streamOpen || Date.now() - lastFetch >= Math.max(page.interval, 15_000) - 500) void refresh();
    await sleep(page.interval);
  }
  if (wakeTimer) clearTimeout(wakeTimer);
  close();
}

function label(path: string): string {
  return path.replace(raceId, "{id}").replace(/\/administrator\//, "/admin/").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "{pid}")
    .replace(/^\/api\/(public\/)?races\/\{id\}\//, "").replace("/api/admin/races/{id}/admin/", "admin/");
}

// ---- Funktionärsåtgärder
const actionLog: { name: string; ms: number; status: number; at: number }[] = [];
async function timed(name: string, run: () => Promise<{ status: number }>): Promise<void> {
  const started = Date.now();
  const result = await run();
  actionLog.push({ name, ms: Date.now() - started, status: result.status, at: started });
  process.stdout.write(`  åtgärd: ${name} ${result.status} på ${Date.now() - started} ms\n`);
}

async function editSharedCourse(office: Client, restore: boolean): Promise<{ status: number }> {
  const courseId = race.extra.sharedCourseId!;
  const list = await office.request("admin courses", `${admin}/courses`, { timeoutMs: 120_000 });
  const course = (JSON.parse(list.text()) as { courses: { courseId: string; controlCodes: number[] }[] }).courses.find((row) => row.courseId === courseId)!;
  const codes = [...course.controlCodes];
  // Byt plats på kontroll 2 och 3 (en felritad bana); tillbaka igen med restore.
  [codes[1], codes[2]] = [codes[2]!, codes[1]!];
  process.stdout.write(`  ${restore ? "återställer" : "ändrar"} banan (${course.controlCodes.length} kontroller)\n`);
  const preview = await office.request("admin course-edit-preview", `${admin}/courses/${courseId}/edit-preview`, { method: "POST",
    body: { formatVersion: 1, controlCodes: codes }, timeoutMs: 120_000 });
  if (preview.status !== 200) return preview;
  const requestId = randomUUID();
  return office.request("admin course-edit", `${admin}/courses/${courseId}/edit`, { method: "POST", timeoutMs: 120_000,
    headers: { "idempotency-key": `course-edit:${requestId}` },
    body: { formatVersion: 1, requestId, courseId, controlCodes: codes, confirmResultChanges: true } });
}

async function shiftClass(office: Client, offsetSeconds: number): Promise<{ status: number }> {
  const correction = { action: "SHIFT_START_TIMES", classId: race.extra.movedClassId, offsetSeconds, reason: "Starten kom igång sent" };
  const preview = await office.request("admin race-corrections preview", `${admin}/race-corrections/preview`, { method: "POST",
    body: { formatVersion: 1, correction }, timeoutMs: 120_000 });
  if (preview.status !== 200) return preview;
  const { previewHash } = JSON.parse(preview.text()) as { previewHash: string };
  return office.request("admin race-corrections", `${admin}/race-corrections`, { method: "POST", timeoutMs: 120_000,
    body: { formatVersion: 1, requestId: randomUUID(), expectedPreviewHash: previewHash, correction } });
}

async function resultsOfficial(office: Client): Promise<{ status: number }> {
  const requestId = randomUUID();
  const reply = await office.request("admin results-official", `${admin}/results-official`, { method: "POST", timeoutMs: 120_000,
    headers: { "idempotency-key": `results-official:${requestId}` }, body: { formatVersion: 1, requestId, action: "OFFICIAL" } });
  if (reply.status === 200) process.stdout.write(`  resultaten är klara: ${(JSON.parse(reply.text()) as { result: { outcome: string } }).result.outcome}\n`);
  return reply;
}

async function main(): Promise<void> {
  const visitorCount = Number(args.visitors), readoutCount = Math.min(Number(args.readouts), race.pending.length);
  const meters = args.cgroups.split(",").filter(Boolean).map((part) => { const [name, path] = part.split("="); return new CgroupMeter(name!, path!); });
  const loadSamples: number[] = [];
  const sampler = setInterval(() => {
    for (const meter of meters) meter.sample();
    loadSamples.push(Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]));
  }, 1_000);
  const generatorCpu = process.cpuUsage();
  const office = client();
  await office.login(manifest.email, manifest.password);
  // Deltagarsidorna: publika resultat-id ur resultatlistan.
  const results = await office.request("förberedelse", `/api/public/races/${raceId}/results`, { timeoutMs: 120_000 });
  const participantIds = results.status === 200 ? (JSON.parse(results.text()) as { results: { publicResultId?: string }[] }).results
    .flatMap((row) => row.publicResultId ? [row.publicResultId] : []).slice(0, 500) : [];
  const relayRace = args.race !== "individual";
  const pages: Page[] = [
    { name: "resultat", html: `/results/${raceId}`, stream: true, interval: 5_000,
      reads: [`/api/public/races/${raceId}/results`, `/api/public/races/${raceId}/relay-results`, `/api/public/races/${raceId}/radio`] },
    { name: "live", html: `/t/${race.shortCode}/live`, stream: true, interval: 5_000, reads: [`/api/public/races/${raceId}/live`] },
    { name: "resultat", html: `/results/${raceId}`, stream: true, interval: 5_000,
      reads: [`/api/public/races/${raceId}/results`, `/api/public/races/${raceId}/relay-results`, `/api/public/races/${raceId}/radio`] },
    ...(relayRace ? [] : [{ name: "startlista", html: `/starts/${raceId}`, stream: false, interval: 5_000, reads: [`/api/races/${raceId}/start-list`] }]),
    ...(participantIds.length === 0 ? [] : [{ name: "deltagare", html: `/results/${raceId}/participants/{pid}`, stream: true, interval: 5_000,
      reads: [`/api/public/races/${raceId}/results/{pid}`] }]),
    { name: "live", html: `/t/${race.shortCode}/live`, stream: true, interval: 5_000, reads: [`/api/public/races/${raceId}/live`] },
    { name: "tävlingssidan", html: `/t/${race.shortCode}`, stream: false, interval: 30_000, reads: [`/t/${race.shortCode}`] }
  ];
  process.stdout.write(`Lasttest ${args.race}: ${visitorCount} besökare, ${readoutCount} avläsningar på ${args.minutes} min, ${args.devices} datorer\n`);
  const startedAt = Date.now();
  const visitors: Promise<void>[] = [];
  for (let index = 0; index < visitorCount; index += 1) {
    visitors.push(visitor(index, pages, participantIds));
    if (index % 10 === 9) await sleep(300);
  }
  const speakerPage: Page = { name: "speaker", html: `/admin/${raceId}/speaker`, stream: true, interval: 10_000,
    reads: [`${admin}/speaker-board`, `/api/public/races/${raceId}/results`, `${admin}/forest-watch`, `${admin}/relay`, `/api/public/races/${raceId}/radio`] };
  const speakers = Array.from({ length: Number(args.speakers) }, async (_, index) => {
    const screen = client();
    await screen.login(manifest.email, manifest.password);
    let running = false;
    const refresh = async () => {
      if (running) return;
      running = true;
      try { await Promise.all(speakerPage.reads.map((path) => screen.request(`speaker ${label(path)}`, path))); } finally { running = false; }
    };
    // Speakersidan: samma väckning som publiken (spridd med --client new), egen hämtning var tionde sekund.
    let wakeTimer: ReturnType<typeof setTimeout> | undefined, lastWake = Number.NEGATIVE_INFINITY;
    const wake = () => {
      if (args.client !== "new") { void refresh(); return; }
      if (wakeTimer) return;
      wakeTimer = setTimeout(() => { wakeTimer = undefined; lastWake = Date.now(); void refresh(); },
        Math.max(0, lastWake + 3_000 - Date.now()) + Math.random() * 1_000);
    };
    const close = screen.stream(`/api/public/races/${raceId}/result-events`, wake, () => undefined);
    await sleep(index * 3_000);
    while (!stopping) { void refresh(); await sleep(speakerPage.interval); }
    if (wakeTimer) clearTimeout(wakeTimer);
    close();
  });

  // Målrusningen börjar när publiken är på plats.
  await sleep(20_000);
  const rushStart = Date.now();
  const runs = race.pending.slice(0, readoutCount);
  const times = arrivals(runs.length, durationMs);
  const devices = Number(args.devices);
  const rush = Array.from({ length: devices }, (_, index) => readoutDevice(index,
    runs.filter((_, run) => run % devices === index), times.filter((_, run) => run % devices === index), rushStart));
  const actions = !args.actions ? Promise.resolve() : (async () => {
    await sleep(durationMs * 0.3);
    if (race.extra.sharedCourseId) {
      await timed("redigera bana (delad, > 300 avlästa)", () => editSharedCourse(office, false));
      await sleep(30_000);
      await timed("redigera bana tillbaka", () => editSharedCourse(office, true));
    }
    await sleep(30_000);
    if (race.extra.movedClassId) {
      await timed("flytta klassens starttider +2 min", () => shiftClass(office, 120));
      await sleep(20_000);
      await timed("flytta klassens starttider -2 min", () => shiftClass(office, -120));
    }
  })();
  await Promise.all([...rush, actions]);
  const rushEnd = Date.now();
  if (args.actions) await timed("resultaten är klara", () => resultsOfficial(office));
  await sleep(15_000);
  stopping = true;
  await Promise.race([Promise.all([...visitors, ...speakers]), sleep(15_000)]);
  clearInterval(sampler);
  const cpu = process.cpuUsage(generatorCpu);

  // ---- Rapport
  const sorted = [...beskedMs].sort((a, b) => a - b);
  const freshness = [...seen.values()].map((list) => Math.min(...list)).sort((a, b) => a - b);
  const notSeen = [...acked.keys()].filter((name) => !seen.has(name)).length;
  const rows = summarize(recorder.samples, rushStart, rushEnd);
  const resources = meters.map((meter) => ({ name: meter.name, cpu: averages(meter.cpu), memoryMb: averages(meter.memoryMb) }));
  const generatorCores = (cpu.user + cpu.system) / 1e6 / ((Date.now() - startedAt) / 1000);
  const report = [
    `## ${args.label || args.race}: ${visitorCount} besökare, ${runs.length} avläsningar på ${args.minutes} min`,
    "",
    `Besked på avläsningsdatorn (insatt bricka → kvitto): p50 ${percentile(sorted, 50).toFixed(0)} ms, p95 ${percentile(sorted, 95).toFixed(0)} ms, ` +
      `p99 ${percentile(sorted, 99).toFixed(0)} ms, max ${(sorted.at(-1) ?? 0).toFixed(0)} ms (${sorted.length} st)` +
      (devicesWithoutPackage > 0 ? `; ${devicesWithoutPackage} av ${devices} avläsningsdatorer fick aldrig avläsningspaketet.` : "."),
    `Uppdatering till publiken (kvitto → syns hos en provbesökare): p50 ${(percentile(freshness, 50) / 1000).toFixed(1)} s, ` +
      `p95 ${(percentile(freshness, 95) / 1000).toFixed(1)} s, max ${((freshness.at(-1) ?? 0) / 1000).toFixed(1)} s; ${notSeen} syntes aldrig.`,
    `Resurser: ${resources.map((row) => `${row.name} CPU medel ${row.cpu.mean.toFixed(2)} / p95 ${row.cpu.p95.toFixed(2)} kärnor, minne max ` +
      `${row.memoryMb.max.toFixed(0)} MB`).join("; ") || "ej mätt"}; lastgeneratorn ${generatorCores.toFixed(2)} kärnor; ` +
      `belastning (load) medel ${averages(loadSamples).mean.toFixed(1)}, max ${averages(loadSamples).max.toFixed(1)}.`,
    `Fel: ${recorder.errors.size === 0 ? "inga" : [...recorder.errors].map(([key, count]) => `${key} × ${count}` +
      (recorder.firstErrorAt.has(key) ? ` (första efter ${((recorder.firstErrorAt.get(key)! - startedAt) / 1000).toFixed(0)} s)` : "")).join(", ")}.`,
    ...(actionLog.length === 0 ? [] : ["", "| Åtgärd | status | ms |", "|---|---:|---:|", ...actionLog.map((row) => `| ${row.name} | ${row.status} | ${row.ms} |`)]),
    "",
    "Under rusningen:",
    "",
    table(rows),
    ""
  ].join("\n");
  process.stdout.write(`\n${report}\n`);
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify({ args, report, rows, besked: { p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99) },
    freshness: { p50: percentile(freshness, 50), p95: percentile(freshness, 95), notSeen }, resources, generatorCores, actions: actionLog,
    errors: Object.fromEntries(recorder.errors), all: summarize(recorder.samples) }, null, 1));
  writeFileSync(args.out.replace(/\.json$/, ".md"), report);
  process.exit(0);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
