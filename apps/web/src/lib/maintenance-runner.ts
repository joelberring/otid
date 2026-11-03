import { retentionSettings, runMaintenance, syncDueClubEventorMembers } from "@o-tid/application";
import { db } from "./db";

/**
 * ADR-0189: underhållet i webbprocessen (som radiopollern, startas från `instrumentation.ts`), fem minuter efter start och
 * sedan en gång i timmen: kartinnehåll som ingen tävling pekar på och avbrutna uppladdningar tas bort, och den valfria
 * gallringen (`OTID_RETENTION`, `OTID_RETENTION_MONTHS`) anonymiserar eller tar bort gamla tävlingar. Bara tävlingsinstansen
 * kör det (inte publikens, `OTID_INSTANCE_ROLE=public`); varje tävling gallras i en egen transaktion med radlås, så två
 * instanser gör aldrig samma sak. ADR-0209: kopplade klubbarkivs medlemslistor från Eventor hämtas när de är äldre än ett
 * dygn (högst tio klubbar per varv). Loggen har bara antal, aldrig namn eller adresser. Stängs av med `OTID_MAINTENANCE=off`.
 */
const HOUR = 60 * 60_000;
type RunnerState = { started: boolean; running: boolean };
const globalRunner = globalThis as typeof globalThis & { oTidMaintenance?: RunnerState };

async function tick(state: RunnerState): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    const { swept, retention } = await runMaintenance(db, retentionSettings(process.env), new Date());
    if (swept.contents + swept.parts > 0) console.info(`Underhåll: ${swept.contents} kartinnehåll och ${swept.parts} delar utan tävling borttagna`);
    if (retention.anonymizedRaces + retention.deletedEvents > 0) {
      console.info(`Gallring: ${retention.anonymizedRaces} tävlingar anonymiserade (${retention.anonymizedEntries} deltagare), ` +
        `${retention.deletedEvents} evenemang borttagna`);
    }
    const members = await syncDueClubEventorMembers(db, new Date());
    if (members.synced + members.failed > 0) console.info(`Klubbarnas medlemslistor: ${members.synced} hämtade, ${members.failed} misslyckades`);
  } catch (error) {
    console.error(`Underhållet avbröts av ett fel: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    state.running = false;
  }
}

export function startMaintenanceRunner(environment: Partial<Record<string, string | undefined>> = process.env): void {
  if (environment.OTID_INSTANCE_ROLE?.trim().toLowerCase() === "public" || environment.OTID_MAINTENANCE?.trim().toLowerCase() === "off") return;
  const state = globalRunner.oTidMaintenance ??= { started: false, running: false };
  if (state.started) return;
  state.started = true;
  const settings = retentionSettings(environment);
  console.info(settings.mode === "off" ? "Gallring: av (OTID_RETENTION)"
    : `Gallring: ${settings.mode === "anonymize" ? "anonymiserar" : "tar bort"} tävlingar äldre än ${settings.months} månader`);
  setTimeout(() => {
    void tick(state);
    setInterval(() => void tick(state), HOUR).unref();
  }, 5 * 60_000).unref();
}
