import { eventorConfigurationFromEnvironment, type EventorRuntime } from "@o-tid/application";

/**
 * Eventor i servern (ADR-0170 beslut 4). Läses från miljön vid varje anrop:
 * `OTID_EVENTOR_MASTER_KEY` (32 slumpade bytes i base64) krypterar klubbarnas nycklar och
 * `OTID_EVENTOR_BASE_URL` sätts bara av driften för en testserver. Utan masternyckel startar
 * appen ändå och visar att Eventor inte är konfigurerat. Inget av detta når webbläsaren.
 */
export function eventorRuntime(environment: Record<string, string | undefined> = process.env): EventorRuntime {
  return { configuration: eventorConfigurationFromEnvironment(environment) };
}
