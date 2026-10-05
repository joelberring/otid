import { normalizeAccountEmail } from "@o-tid/contracts";

/** Kontaktadressen till den som driver O-Tid (`OTID_CONTACT_EMAIL`). Visas bara när den är satt och giltig. */
export function operatorContactEmail(environment: Record<string, string | undefined> = process.env): string | null {
  const value = environment.OTID_CONTACT_EMAIL?.trim();
  return value && normalizeAccountEmail(value) ? value : null;
}
