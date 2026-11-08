/**
 * Steg 65 (ADR-0184, ADR-0177): utskriftsarbetaren. Tar PDF-jobben ur kön (`course_setting_print_job`) ett i taget och
 * skriver PDF:erna, i en egen process med lägsta prioritet (nice 19) och en egen liten databaspool, så att avläsning och
 * tävlingsarbete aldrig väntar på en utskrift. Rensar gamla PDF:er var tionde minut.
 *
 * ADR-0186: varje jobb skrivs i en egen barnprocess med tidsgräns (`OTID_PRINT_JOB_TIMEOUT_MS`, förval 10 minuter) och eget
 * minnestak (`OTID_PRINT_JOB_MEMORY_MB`, förval 256). Ett jobb som hänger eller tar slut på minnet avbryts och blir FAILED med
 * en förklaring, och kön går vidare med nästa. Huvudprocessen rör filen `/tmp/otid-print-worker-alive` minst var 30:e sekund,
 * så att hälsokontrollen i docker-compose.prod.yml ser att arbetaren lever.
 *
 * I drift: tjänsten `print-worker` i docker-compose.prod.yml (`node print-worker.mjs`, egen CPU-vikt och minnestak).
 * Lokalt startar `pnpm dev` den (apps/web/scripts/dev.mjs) om inte OTID_PRINT_WORKER=off.
 *
 *   tsx scripts/print-worker.ts           kör tills processen stoppas
 *   tsx scripts/print-worker.ts --once    tar högst ett jobb och avslutar (tester)
 *   (internt) print-worker --job <id> --race <id> --attempts <n> --worker <namn>   skriver ett jobb (barnprocessen)
 */
import { fork } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, setPriority } from "node:os";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../packages/database/src/index.ts";
import { claimPrintJob, cleanupPrintJobs, failPrintJob, heartbeatPrintJob, runPrintJob } from "../packages/application/src/course-setting-print.ts";
import {
  claimMapJob, cleanupMapJobs, failMapJob, heartbeatMapJob, loadClaimedMapJob, MAP_JOB_CHANNEL, runMapJob
} from "../packages/application/src/map-project-jobs.ts";
import { createMapJobCanvas } from "./map-job-canvas.ts";
import { FONT_FILE_NAMES, FONT_VARIANTS, type FontFiles } from "../packages/print-pdf/src/index.ts";

const CLEANUP_MS = 10 * 60_000;
const HEARTBEAT_MS = 30_000;
export const ALIVE_FILE = "/tmp/otid-print-worker-alive";

/** Typsnitten: OTID_PRINT_FONT_DIR, mappen `fonts` bredvid det paketerade kommandot eller paketets egen mapp. */
export function loadFonts(environment: NodeJS.ProcessEnv = process.env): FontFiles {
  const candidates = [environment.OTID_PRINT_FONT_DIR, fileURLToPath(new URL("./fonts/", import.meta.url)),
    fileURLToPath(new URL("../packages/print-pdf/fonts/", import.meta.url))].filter((dir): dir is string => Boolean(dir));
  const dir = candidates.find(candidate => existsSync(`${candidate.replace(/\/$/, "")}/${FONT_FILE_NAMES.regular}`));
  if (!dir) throw new Error(`Typsnitten för PDF:en saknas (sökte i ${candidates.join(", ")})`);
  return Object.fromEntries(FONT_VARIANTS.map(variant => [variant, new Uint8Array(readFileSync(`${dir.replace(/\/$/, "")}/${FONT_FILE_NAMES[variant]}`))])) as unknown as FontFiles;
}

/** Tidsgränsen och minnestaket för ett jobb ur miljön (ogiltiga värden ger förvalen). */
export function jobLimits(environment: NodeJS.ProcessEnv = process.env): { timeoutMs: number; memoryMb: number } {
  const timeout = Number(environment.OTID_PRINT_JOB_TIMEOUT_MS);
  const memory = Number(environment.OTID_PRINT_JOB_MEMORY_MB);
  return { timeoutMs: Number.isFinite(timeout) && timeout >= 1_000 ? timeout : 10 * 60_000,
    memoryMb: Number.isFinite(memory) && memory >= 64 ? Math.round(memory) : 256 };
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});

function alive(): void {
  try { writeFileSync(ALIVE_FILE, String(Date.now())); } catch (error) {
    console.warn("Utskriftsarbetaren kunde inte skriva sitt livstecken", error instanceof Error ? error.message : error);
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** Barnprocessen: skriver ett taget jobb och skickar utfallet till huvudprocessen. */
async function runChild(url: string): Promise<void> {
  const id = argument("--job"), raceId = argument("--race"), worker = argument("--worker"), attempts = Number(argument("--attempts"));
  if (!id || !raceId || !worker || !Number.isInteger(attempts)) throw new Error("Barnprocessen saknar jobbets uppgifter");
  try { setPriority(19); } catch { /* ärvs redan från huvudprocessen */ }
  const { db, pool } = createDatabase(url, { max: 1, applicationName: "otid-print-job", statementTimeoutMs: 120_000, idleInTransactionTimeoutMs: 30_000 });
  try {
    const outcome = await runPrintJob(db, { id, raceId, attempts }, { fonts: loadFonts(), worker });
    process.send?.({ outcome });
  } finally { await pool.end(); }
}

/** ADR-0219 (K2): barnprocessen för ett kartjobb (jobbet är redan taget av huvudprocessen). */
async function runMapChild(url: string): Promise<void> {
  const id = argument("--map-job"), worker = argument("--worker");
  if (!id || !worker) throw new Error("Barnprocessen saknar kartjobbets uppgifter");
  try { setPriority(19); } catch { /* ärvs redan från huvudprocessen */ }
  const { db, pool } = createDatabase(url, { max: 1, applicationName: "otid-map-job", statementTimeoutMs: 60_000, idleInTransactionTimeoutMs: 30_000 });
  try {
    const job = await loadClaimedMapJob(db, id, worker);
    if (!job) { process.send?.({ outcome: "GONE" }); return; }
    const outcome = await runMapJob(db, job, { worker, createCanvas: createMapJobCanvas });
    process.send?.({ outcome });
  } finally { await pool.end(); }
}

/** Tidsgränsen och minnestaket för ett kartjobb (kort: personen väntar på svaret). */
export function mapJobLimits(environment: NodeJS.ProcessEnv = process.env): { timeoutMs: number; memoryMb: number } {
  const timeout = Number(environment.OTID_MAP_JOB_TIMEOUT_MS);
  const memory = Number(environment.OTID_MAP_JOB_MEMORY_MB);
  return { timeoutMs: Number.isFinite(timeout) && timeout >= 1_000 ? timeout : 60_000,
    memoryMb: Number.isFinite(memory) && memory >= 64 ? Math.round(memory) : 256 };
}

/** Kör jobbet i en barnprocess; avbryter den efter tidsgränsen. Ger utfallet eller felet att spara. */
function runInChild(job: { id: string; raceId: string; attempts: number }, worker: string, limits: { timeoutMs: number; memoryMb: number },
  args: string[] = ["--job", job.id, "--race", job.raceId, "--attempts", String(job.attempts), "--worker", worker])
  : Promise<{ outcome?: string; failure?: string }> {
  return new Promise(resolve => {
    const environment = { ...process.env };
    delete environment.NODE_OPTIONS;
    const child = fork(process.argv[1]!, args, {
      execArgv: [...process.execArgv, `--max-old-space-size=${limits.memoryMb}`], env: environment, stdio: "inherit" });
    let outcome: string | undefined;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, limits.timeoutMs);
    child.on("message", (message: unknown) => {
      if (message && typeof message === "object" && "outcome" in message) outcome = String((message as { outcome: unknown }).outcome);
    });
    child.on("error", error => console.error(`Utskriftsjobb ${job.id}: barnprocessen kunde inte startas`, error.message));
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) resolve({ failure: `Jobbet tog längre tid än ${Math.round(limits.timeoutMs / 60_000)} minuter och avbröts. Dela upp utskriften eller försök igen.` });
      else if (outcome) resolve({ outcome });
      else resolve({ failure: `PDF:en kunde inte skrivas (processen avslutades${signal ? ` med ${signal}` : ` med kod ${code}`}, till exempel när minnet tog slut). Dela upp utskriften eller försök igen.` });
    });
  });
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Sätt DATABASE_URL till databasen.");
  if (argument("--job")) return runChild(url);
  if (argument("--map-job")) return runMapChild(url);
  const once = process.argv.includes("--once");
  const pollMs = Math.max(200, Number(process.env.OTID_PRINT_POLL_MS ?? 2000) || 2000);
  const limits = jobLimits();
  // Lägsta prioritet: tävlingens processer får processorn först (ADR-0177). Kräver inga rättigheter; barnen ärver den.
  try { setPriority(19); } catch (error) { console.warn("Utskriftsarbetaren kunde inte sänka sin prioritet", error); }
  loadFonts(); // fel tidigt om typsnitten saknas
  // Två till utskrifterna, två till kartjobben (en av dem lyssnar på `pg_notify`).
  const { db, pool } = createDatabase(url, { max: 4, applicationName: "otid-print-worker", statementTimeoutMs: 120_000, idleInTransactionTimeoutMs: 30_000 });
  const worker = `${hostname()}:${process.pid}`;
  const stop = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => stop.abort());
  if (process.argv.includes("--map-once")) {
    await mapLoop(db, pool, worker, stop.signal, true).finally(() => pool.end());
    return;
  }
  const maps = mapLoop(db, pool, worker, stop.signal, false).catch((error: unknown) => {
    console.error("Kartjobben stannade", error instanceof Error ? error.message : error);
  });
  let cleaned = 0;
  console.log(`Utskriftsarbetaren startad (${worker}, tidsgräns ${Math.round(limits.timeoutMs / 1000)} s per jobb)`);
  alive();
  try {
    while (!stop.signal.aborted) {
      alive();
      if (Date.now() - cleaned > CLEANUP_MS) {
        cleaned = Date.now();
        const result = await cleanupPrintJobs(db).catch((error: unknown) => {
          console.error("Rensningen av PDF:er misslyckades", error instanceof Error ? error.message : error);
          cleaned = Date.now() - CLEANUP_MS + 60_000;
          return undefined;
        });
        if (result && (result.expired > 0 || result.deleted > 0)) console.log(`Rensat: ${result.expired} PDF:er, ${result.deleted} gamla jobb`);
      }
      let job;
      try {
        job = await claimPrintJob(db, worker);
      } catch (error) {
        // Databasen nere eller inte migrerad än: försök igen om en stund (jobben väntar i kön).
        if (once) throw error;
        console.error("Utskriftsarbetaren når inte kön; försöker igen om 10 s", error instanceof Error ? error.message : error);
        await sleep(10_000, stop.signal);
        continue;
      }
      if (!job) {
        if (once) break;
        await sleep(pollMs, stop.signal);
        continue;
      }
      const claimed = job;
      const heartbeat = setInterval(() => {
        alive();
        void heartbeatPrintJob(db, claimed.id, worker).catch((error: unknown) => console.warn("Livstecknet för utskriftsjobbet misslyckades", error));
      }, HEARTBEAT_MS);
      try {
        const started = Date.now();
        const result = await runInChild(claimed, worker, limits);
        if (result.failure) {
          await failPrintJob(db, claimed.id, worker, result.failure);
          console.error(`Utskriftsjobb ${claimed.id}: FAILED på ${Math.round((Date.now() - started) / 100) / 10} s (${result.failure})`);
          if (once) throw new Error(result.failure);
        } else console.log(`Utskriftsjobb ${claimed.id}: ${result.outcome} på ${Math.round((Date.now() - started) / 100) / 10} s`);
      } finally { clearInterval(heartbeat); }
      if (once) break;
    }
  } finally {
    stop.abort();
    await maps;
    await pool.end();
  }
}

/**
 * ADR-0219 (K2): kartjobben, parallellt med utskrifterna (personen väntar på svaret). Ett jobb i taget i en barnprocess med
 * kort tidsgräns; `pg_notify('otid_map_job')` väcker loopen direkt, annars tittar den varannan sekund. `once`: tar jobb tills
 * kön är tom och slutar (testerna).
 */
async function mapLoop(db: ReturnType<typeof createDatabase>["db"], pool: ReturnType<typeof createDatabase>["pool"], worker: string,
  signal: AbortSignal, once: boolean): Promise<void> {
  const limits = mapJobLimits();
  let wake: (() => void) | undefined;
  const listener = once ? undefined : await pool.connect().catch(() => undefined);
  if (listener) {
    listener.on("notification", () => wake?.());
    await listener.query(`LISTEN ${MAP_JOB_CHANNEL}`).catch(() => undefined);
  }
  let cleaned = 0;
  try {
    while (!signal.aborted) {
      if (Date.now() - cleaned > CLEANUP_MS) {
        cleaned = Date.now();
        await cleanupMapJobs(db).catch((error: unknown) => console.error("Rensningen av kartjobb misslyckades", error instanceof Error ? error.message : error));
      }
      let job;
      try { job = await claimMapJob(db, worker); }
      catch (error) {
        if (once) throw error;
        console.error("Kartjobben når inte kön; försöker igen om 10 s", error instanceof Error ? error.message : error);
        await sleep(10_000, signal);
        continue;
      }
      if (!job) {
        if (once) return;
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 2000);
          wake = () => { clearTimeout(timer); resolve(); };
          signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
        });
        wake = undefined;
        continue;
      }
      const claimed = job;
      const heartbeat = setInterval(() => void heartbeatMapJob(db, claimed.id, worker).catch(() => undefined), HEARTBEAT_MS);
      try {
        const started = Date.now();
        const result = await runInChild({ id: claimed.id, raceId: "", attempts: claimed.attempts }, worker, limits,
          ["--map-job", claimed.id, "--worker", worker]);
        if (result.failure) {
          await failMapJob(db, claimed.id, worker, `Kartjobbet avbröts (tidsgränsen ${Math.round(limits.timeoutMs / 1000)} s eller minnet tog slut). Försök med ett mindre område.`);
          console.error(`Kartjobb ${claimed.id} (${claimed.kind}): FAILED på ${Math.round((Date.now() - started) / 100) / 10} s`);
        } else console.log(`Kartjobb ${claimed.id} (${claimed.kind}): ${result.outcome} på ${Math.round((Date.now() - started) / 100) / 10} s`);
      } finally { clearInterval(heartbeat); }
    }
  } finally {
    listener?.release();
  }
}

if (process.argv[1] && /print-worker\.(ts|mjs)$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
