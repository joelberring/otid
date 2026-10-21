import { normalizeAccountEmail } from "@o-tid/contracts";
import { PROGRAM_CONTACT_EMAIL } from "./contact";

/**
 * Kontaktadressen till den som driver O-Tid: `OTID_CONTACT_EMAIL` när den är satt och giltig, annars adressen för
 * frågor om programmet (PLAN.md steg 37).
 */
export function operatorContactEmail(environment: Record<string, string | undefined> = process.env): string {
  const value = environment.OTID_CONTACT_EMAIL?.trim();
  return value && normalizeAccountEmail(value) ? value : PROGRAM_CONTACT_EMAIL;
}
