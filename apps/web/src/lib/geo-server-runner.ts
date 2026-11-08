import { geoServerSettings, hetznerClient, manageGeoServer, superadminRecipients } from "@o-tid/application";
import { db } from "./db";
import { serverMailer } from "./server-watch-runner";

/**
 * ADR-0219 K5b: geo-servern startas och raderas av webbprocessen (tävlingens instans, inte publikens), en gång i minuten när
 * `OTID_HETZNER_TOKEN` och `O_TID_PUBLIC_ORIGIN` är satta. Det finns bara en sådan instans, så ett varv i taget räcker.
 */
type Env = Partial<Record<string, string | undefined>>;
type RunnerState = { started: boolean; running: boolean };
const globalRunner = globalThis as typeof globalThis & { oTidGeoServer?: RunnerState };

async function tick(state: RunnerState, environment: Env): Promise<void> {
  const settings = geoServerSettings(environment);
  if (!settings || state.running) return;
  state.running = true;
  try {
    const send = serverMailer(environment);
    const result = await manageGeoServer(db, hetznerClient(settings.token), settings, async message => {
      await send(message, await superadminRecipients(db));
    });
    if (result.action !== "none") console.info(`Geo-servern: ${result.action}${result.detail ? ` (${result.detail})` : ""}`);
  } catch (error) {
    console.error(`Geo-servern: varvet avbröts av ett fel: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    state.running = false;
  }
}

export function startGeoServerRunner(environment: Env = process.env): void {
  if (environment.OTID_INSTANCE_ROLE?.trim().toLowerCase() === "public") return;
  const settings = geoServerSettings(environment);
  if (!settings) return;
  const state = globalRunner.oTidGeoServer ??= { started: false, running: false };
  if (state.started) return;
  state.started = true;
  console.info(`Geo-servern: typer ${settings.types.join(", ")}, platser ${settings.locations.join(", ")}, tomgång ${settings.idleMinutes} min, `
    + `budget ${settings.budgetEur} €/månad, avbildningen ${settings.image} (ADR-0219 K5b)`);
  setInterval(() => void tick(state, environment), 60_000).unref();
}
