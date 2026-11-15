import { archiveMode, archiveNumberProblems, archiveSettings, archiveSettingsProblems, mapArchiveStore, runMapArchive } from "@o-tid/application";
import { db } from "./db";

/**
 * ADR-0224, PLAN.md steg L5: arkivet för vilande kartinnehåll, i webbprocessen (som underhållet, startas från
 * `instrumentation.ts`). Tio minuter efter start och sedan en gång i timmen flyttas laserkörningars resultatfiler som vilar
 * till objektlagringen. `OTID_ARCHIVE_MODE`: off (förval), log (skriver bara vad som skulle ha flyttats) eller on. Bara
 * tävlingsinstansen kör det. Loggen har antal och storlek, aldrig namn.
 */
const HOUR = 60 * 60_000, MB = 1024 * 1024;
type RunnerState = { started: boolean; running: boolean };
const globalRunner = globalThis as typeof globalThis & { oTidMapArchive?: RunnerState };
const mb = (bytes: number) => `${Math.round(bytes / MB)} MB`;

async function tick(state: RunnerState, environment: Partial<Record<string, string | undefined>>): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    const mode = archiveMode(environment);
    const result = await runMapArchive(db, mapArchiveStore(environment), archiveSettings(environment, mode), new Date());
    const { planned } = result;
    if (planned.count > 0) {
      console.info(`Arkivet${mode === "log" ? " (bara logg)" : ""}: ${planned.count} laserfiler (${mb(planned.bytes)}) ${mode === "log" ? "skulle ha flyttats" : "att flytta"}: ` +
        `${planned.rules.PRESSURE} av utrymmesskäl, ${planned.rules.SUPERSEDED} ersatta, ${planned.rules.IDLE} vilande; ${mb(result.hotBytes)} laserfiler på servern` +
        `${result.raceDay ? "; tävlingsdag, bara utrymmesregeln" : ""}`);
    }
    if (result.uploaded + result.cooled + result.orphansRemoved > 0) {
      console.info(`Arkivet: ${result.uploaded} uppladdade, ${result.cooled} borttagna här (${mb(result.freedBytes)} frigjort), ${result.orphansRemoved} raderade i arkivet`);
    }
    if (result.failed > 0) console.error(`Arkivet: ${result.failed} misslyckades: ${result.errors.join("; ")}`);
  } catch (error) {
    console.error(`Arkivet avbröts av ett fel: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    state.running = false;
  }
}

export function startMapArchiveRunner(environment: Partial<Record<string, string | undefined>> = process.env): void {
  for (const problem of [...archiveSettingsProblems(environment), ...archiveNumberProblems(environment)]) console.warn(problem);
  const mode = archiveMode(environment);
  if (environment.OTID_INSTANCE_ROLE?.trim().toLowerCase() === "public" || mode === "off") return;
  const state = globalRunner.oTidMapArchive ??= { started: false, running: false };
  if (state.started) return;
  state.started = true;
  const settings = archiveSettings(environment, mode);
  console.info(`Arkivet för kartinnehåll: ${mode === "log" ? "bara logg" : "på"}; ersatta körningar efter ${settings.supersededHours} h, vilande projekt efter ` +
    `${settings.idleDays} dygn, högst ${settings.accountHotBytes === null ? "obegränsat" : mb(settings.accountHotBytes)} laserfiler per konto på servern (ADR-0224)`);
  setTimeout(() => {
    void tick(state, environment);
    setInterval(() => void tick(state, environment), HOUR).unref();
  }, 10 * 60_000).unref();
}
