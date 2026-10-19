import { eventorConfigurationFromEnvironment, type EventorRuntime } from "@o-tid/application";

/**
 * Eventor i servern (ADR-0170 beslut 4). Läses från miljön vid varje anrop:
 * `OTID_EVENTOR_MASTER_KEY` (32 slumpade bytes i base64) krypterar klubbarnas nycklar och
 * `OTID_EVENTOR_BASE_URL` sätts bara av driften för en testserver. Utan masternyckel startar
 * appen ändå och visar att Eventor inte är konfigurerat. Inget av detta når webbläsaren; vad som saknas
 * står bara i serverns logg (PLAN.md steg 27).
 */
type Environment = Record<string, string | undefined>;
const logged = globalThis as typeof globalThis & { oTidEventorConfigLogged?: string };

export function eventorRuntime(environment: Environment = process.env): EventorRuntime {
  const configuration = eventorConfigurationFromEnvironment(environment);
  if (configuration.status !== "ok" && logged.oTidEventorConfigLogged !== configuration.status) {
    logged.oTidEventorConfigLogged = configuration.status;
    console.warn(configuration.status === "missing"
      ? "Eventor: servern saknar OTID_EVENTOR_MASTER_KEY (se docs/drift.md)"
      : "Eventor: OTID_EVENTOR_MASTER_KEY eller OTID_EVENTOR_BASE_URL är ogiltig (se docs/drift.md)");
  }
  return { configuration };
}

/**
 * Varning vid start (PLAN.md steg 27): de gamla namnen `OTID_EVENTOR_MASTER_KEY_ID` och `OTID_EVENTOR_MASTER_KEY_BASE64`
 * används inte längre. Står de i miljön utan `OTID_EVENTOR_MASTER_KEY` blir Eventor avslaget utan förklaring i webben.
 * Ger texten att logga, eller `undefined`. Värdena skrivs aldrig ut.
 */
export function legacyEventorEnvironmentWarning(environment: Environment): string | undefined {
  const old = ["OTID_EVENTOR_MASTER_KEY_ID", "OTID_EVENTOR_MASTER_KEY_BASE64"].filter(name => environment[name]?.trim());
  if (old.length === 0 || environment.OTID_EVENTOR_MASTER_KEY?.trim()) return undefined;
  return `Eventor: ${old.join(" och ")} används inte längre. Sätt OTID_EVENTOR_MASTER_KEY (32 slumpade bytes i base64) i stället; ` +
    "se docs/drift.md. Eventor är avslaget tills dess.";
}
