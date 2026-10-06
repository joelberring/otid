import { radioRuntimeFromEnvironment, type RadioRuntime } from "@o-tid/application";

/**
 * Radiokontroller i servern (ADR-0172 beslut 5). `OTID_ROC_BASE_URL` sätts bara av driften för test (en falsk
 * ROC-server); utan den används ROC och OResults riktiga adresser. Inget av detta når webbläsaren.
 */
export function radioRuntime(environment: Record<string, string | undefined> = process.env): RadioRuntime {
  return radioRuntimeFromEnvironment(environment);
}
