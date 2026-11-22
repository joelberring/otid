import {
  activeMapStore, archiveSettings, inMigrateWindow, mapCacheCapBytes, mapCacheDir, migrateSettings, migrateSettingsProblems, probeArchiveStore,
  rawLaserStore, reconcileStoredContent, removeArchiveOrphans, removeExpiredRawLaser, runMapMigration, runPinRound, startMapCacheSweep, storeMode, takeMapMigrationRequest, usableMapCacheDir,
  type MigrateRunSummary, type PinRoundResult
} from "@o-tid/application";
import { db } from "./db";

/**
 * ADR-0229 (PLAN.md steg M1): förrådet och mellanlagret i webbprocessen (som arkivet, startas från `instrumentation.ts`).
 * Bara tävlingsinstansen kör det. Var 5:e minut spikas tävlingars och träningars kartor fast och det som saknas laddas ner
 * (PLAN.md steg M2, `map-pin.ts`), och därefter städas mellanlagret (taket från superadminsidan); en gång i timmen tas
 * objekt bort ur förrådet som släpptes för mer än `OTID_ARCHIVE_ORPHAN_DAYS` sedan (arkivets löpare är avstängd när förrådet
 * är i bruk, PLAN.md steg M3). Varje minut ser löparen efter en beställning från «Flytta nu», och var 10:e minut i nattfönstret
 * flyttas befintligt innehåll ur databasen (`map-store-migrate.ts`).
 * Vid start skrivs en rad i loggen som säger om förrådet är på; den raden kontrollerar ägaren när läget slagits på.
 */
const MINUTE = 60_000;
type RunnerState = { started: boolean; migrating: boolean; lastNightRun: number; lastReconcile: number };
const globalRunner = globalThis as typeof globalThis & { oTidMapStoreRunner?: RunnerState };

export function startMapStoreRunner(environment: Partial<Record<string, string | undefined>> = process.env): void {
  if (environment.OTID_INSTANCE_ROLE?.trim().toLowerCase() === "public") return;
  startRawLaserCleanup(environment);
  if (storeMode(environment) !== "on") return;
  const state = globalRunner.oTidMapStoreRunner ??= { started: false, migrating: false, lastNightRun: 0, lastReconcile: 0 };
  if (state.started) return;
  state.started = true;
  const store = activeMapStore(environment);
  const dir = usableMapCacheDir(environment);
  if (!store) {
    console.warn(`Förrådet: AV trots OTID_STORE_MODE=on (${dir ? "objektlagringens uppgifter OTID_ARCHIVE_* saknas"
      : `mellanlagret ${mapCacheDir(environment)} går inte att skriva i`}); nytt kartinnehåll sparas i databasen`);
  } else {
    console.info(`Förrådet: på; nytt kartinnehåll laddas upp till objektlagringen och mellanlagras i ${dir} (ADR-0229)`);
    void probeArchiveStore(store).then(() => console.info("Förrådet: anslutningen till objektlagringen fungerar"),
      error => console.error(`Förrådet: anslutningen till objektlagringen fungerar INTE: ${error instanceof Error ? error.message : String(error)}`));
  }
  if (!dir) return;
  const pin = async () => {
    if (!store) return;
    try {
      logPinRound(await runPinRound(db, store, dir));
    } catch (error) {
      console.error(`Fastspikningen avbröts: ${error instanceof Error ? error.message : String(error)}; den prövas igen om 5 minuter`);
    }
  };
  const sweep = async () => {
    await pin();
    try {
      const cap = await mapCacheCapBytes(db);
      startMapCacheSweep(dir, cap);
    } catch (error) {
      console.error(`Mellanlagret: taket kunde inte läsas: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const orphans = async () => {
    if (!store) return;
    try {
      const result = await removeArchiveOrphans(db, store, archiveSettings(environment).orphanDays);
      if (result.removed > 0) console.info(`Förrådet: ${result.removed} släppta objekt borttagna`);
      if (result.errors.length > 0) console.error(`Förrådet: ${result.errors.length} borttagningar misslyckades: ${result.errors.slice(0, 5).join("; ")}`);
    } catch (error) {
      console.error(`Förrådets städning avbröts: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const migration = migrateSettings(environment);
  for (const problem of migrateSettingsProblems(environment)) console.warn(problem);
  const migrate = async () => {
    if (!store || !migration.enabled || state.migrating) return;
    state.migrating = true;
    try {
      const request = await takeMapMigrationRequest(db);
      const now = new Date();
      const night = !request && inMigrateWindow(now, migration) && now.getTime() - state.lastNightRun >= 10 * MINUTE - 5_000;
      if (!request && !night) {
        // Återkopplingen efter en återställning (map-store-migrate.ts) görs var 10:e minut också utanför fönstret.
        if (now.getTime() - state.lastReconcile < 10 * MINUTE - 5_000) return;
        state.lastReconcile = now.getTime();
        const result = await reconcileStoredContent(db, store, now);
        if (result.reconciled > 0) console.info(`Flytten till förrådet: Återkopplat ${result.reconciled} innehåll som låg i förrådet`);
        if (result.missing > 0) console.error(`Flytten till förrådet: ${result.missing} innehåll saknar delar i databasen och finns inte i förrådet`);
        return;
      }
      if (night) state.lastNightRun = now.getTime();
      logMigration(await runMapMigration(db, store, migration, { trigger: request ? "MANUAL" : "NIGHT",
        ...(request?.megabytes ? { runBytes: request.megabytes * 1024 * 1024 } : {}) }));
    } catch (error) {
      console.error(`Flytten till förrådet avbröts: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      state.migrating = false;
    }
  };
  if (store && migration.enabled) {
    console.info(`Flytten till förrådet: kl. ${migration.fromHour}–${migration.toHour} svensk tid, högst ${mb(migration.runBytes)} MB per varv, ` +
      `delarna kvar ${migration.graceHours} h (PLAN.md steg M3)`);
  }
  setInterval(() => void migrate(), MINUTE).unref();
  setTimeout(() => void sweep(), MINUTE).unref();
  setInterval(() => void sweep(), 5 * MINUTE).unref();
  setInterval(() => void orphans(), 60 * MINUTE).unref();
}

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

const globalRaw = globalThis as typeof globalThis & { oTidRawLaserCleanup?: boolean };
/**
 * PLAN.md M6: zip-filerna med rå laserdata tas bort ur objektlagringen när deras 7 dygn gått, en gång i timmen (och en
 * minut efter start). Körs så länge `OTID_ARCHIVE_*` finns, också om förrådet slagits av efter att filerna lades dit.
 */
function startRawLaserCleanup(environment: Partial<Record<string, string | undefined>>): void {
  const store = rawLaserStore(environment);
  if (!store || globalRaw.oTidRawLaserCleanup) return;
  globalRaw.oTidRawLaserCleanup = true;
  const clean = async () => {
    try {
      const result = await removeExpiredRawLaser(db, store);
      if (result.removed > 0) console.info(`Rå laserdata: ${result.removed} zip-filer borttagna efter 7 dygn`);
      if (result.errors.length > 0) console.error(`Rå laserdata: ${result.errors.length} borttagningar misslyckades: ${result.errors.slice(0, 5).join("; ")}`);
    } catch (error) {
      console.error(`Rå laserdatans städning avbröts: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  setTimeout(() => void clean(), MINUTE).unref();
  setInterval(() => void clean(), 60 * MINUTE).unref();
}

/** Loggen för flyttens varv: antal och storlek, aldrig namn. Tyst när ingenting hände. */
export function logMigration(result: MigrateRunSummary): void {
  if (result.moved + result.freed + result.reconciled > 0) {
    console.info(`Flytten till förrådet (${result.trigger === "MANUAL" ? "Flytta nu" : "natt"}): ${result.moved} innehåll flyttade (${mb(result.movedBytes)} MB, ` +
      `${mb(result.uploadedBytes)} MB uppladdat), delarna borttagna för ${result.freed} (${mb(result.freedBytes)} MB), ${result.reconciled} återkopplade`);
  }
  if (result.stopped === "RACE_DAY" && result.trigger === "MANUAL") console.warn("Flytten till förrådet: tävlingsdygn, ingenting flyttas i dag");
  if (result.failed > 0) console.error(`Flytten till förrådet: ${result.failed} fel: ${result.errors.join("; ")}`);
}

/** Loggen för ett varv: bara antal och storlek, aldrig namn. Tyst när allt redan låg på plats. */
export function logPinRound(result: PinRoundResult): void {
  if (result.fetched > 0 || result.released > 0) {
    console.info(`Fastspikningen: ${result.pinned} innehåll (${mb(result.pinnedBytes)} MB) spikade, ${result.fetched} hämtade ur förrådet ` +
      `(${mb(result.fetchedBytes)} MB), ${result.released} släppta`);
  }
  if (result.failed > 0) {
    console.error(`Fastspikningen: ${result.failed} innehåll (${mb(result.failedBytes)} MB) kunde inte hämtas ur förrådet och prövas igen ` +
      `om 5 minuter: ${result.errors.join("; ")}`);
  }
  if (result.overLimit) {
    console.warn(`Fastspikningen: ${mb(result.pinnedBytes)} MB spikade passerar gränsen ${mb(result.limitBytes)} MB; allt spikas ändå ` +
      "(tävlingen går först), höj gränsen på superadminsidan eller frigör disk");
  }
}
