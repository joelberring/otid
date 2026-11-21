import {
  activeMapStore, archiveMode, archiveSettings, mapCacheCapBytes, mapCacheDir, probeArchiveStore, removeArchiveOrphans, startMapCacheSweep,
  storeMode, usableMapCacheDir
} from "@o-tid/application";
import { db } from "./db";

/**
 * ADR-0229 (PLAN.md steg M1): förrådet och mellanlagret i webbprocessen (som arkivet, startas från `instrumentation.ts`).
 * Bara tävlingsinstansen kör det. Var 5:e minut städas mellanlagret (taket från superadminsidan); en gång i timmen tas
 * objekt bort ur förrådet som släpptes för mer än `OTID_ARCHIVE_ORPHAN_DAYS` sedan (när arkivet är på gör arkivet det).
 * Vid start skrivs en rad i loggen som säger om förrådet är på; den raden kontrollerar ägaren när läget slagits på.
 */
const MINUTE = 60_000;
type RunnerState = { started: boolean };
const globalRunner = globalThis as typeof globalThis & { oTidMapStoreRunner?: RunnerState };

export function startMapStoreRunner(environment: Partial<Record<string, string | undefined>> = process.env): void {
  if (environment.OTID_INSTANCE_ROLE?.trim().toLowerCase() === "public" || storeMode(environment) !== "on") return;
  const state = globalRunner.oTidMapStoreRunner ??= { started: false };
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
  const sweep = async () => {
    try {
      const cap = await mapCacheCapBytes(db);
      startMapCacheSweep(dir, cap);
    } catch (error) {
      console.error(`Mellanlagret: taket kunde inte läsas: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const orphans = async () => {
    if (!store || archiveMode(environment) === "on") return;
    try {
      const result = await removeArchiveOrphans(db, store, archiveSettings(environment).orphanDays);
      if (result.removed > 0) console.info(`Förrådet: ${result.removed} släppta objekt borttagna`);
      if (result.errors.length > 0) console.error(`Förrådet: ${result.errors.length} borttagningar misslyckades: ${result.errors.slice(0, 5).join("; ")}`);
    } catch (error) {
      console.error(`Förrådets städning avbröts: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  setTimeout(() => void sweep(), MINUTE).unref();
  setInterval(() => void sweep(), 5 * MINUTE).unref();
  setInterval(() => void orphans(), 60 * MINUTE).unref();
}
