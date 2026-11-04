import { INVITATION_BULK_MAX, normalizeAccountEmail, type InvitationMailOutcome } from "@o-tid/contracts";
import type { InvitationTally } from "../i18n/invitation-sv";

/**
 * ADR-0206: flera adresser på en gång. Komma, semikolon, mellanslag och nya rader skiljer adresserna; "Namn <adress>" (från ett
 * e-postprogram) ger adressen. Samma adress två gånger räknas en gång.
 */
export function parseInvitationAddresses(text: string): { addresses: string[]; invalid: string[] } {
  const addresses: string[] = [];
  const invalid: string[] = [];
  // Bara det inom <> när det finns (Namn Efternamn <namn@klubb.se>), så att namnen inte blir ogiltiga adresser.
  const bracketed = [...text.matchAll(/<([^<>\s]+)>/g)].map(match => match[1]!);
  const pieces = bracketed.length > 0 ? bracketed : text.split(/[\s,;]+/);
  for (const piece of pieces) {
    const raw = piece.trim().replace(/^mailto:/i, "");
    if (!raw) continue;
    const email = normalizeAccountEmail(raw);
    if (!email) invalid.push(raw);
    else if (!addresses.includes(email)) addresses.push(email);
  }
  return { addresses, invalid };
}

/** Utfallet per adress: mejlets utfall, "existing" (fanns redan i listan, 409) eller "error" (annat fel). */
export type InvitationAttempt = InvitationMailOutcome | "existing" | "error";

/**
 * Bjuder in adresserna en i taget (var sin begäran och var sitt mejl) och räknar ihop. Ett fel som gäller alla (utloggad, inte
 * behörig) stoppar efter första adressen; `fatal` säger då vilket.
 */
export async function inviteAll(addresses: readonly string[], invalid: number, invite: (email: string) => Promise<InvitationAttempt | { fatal: number }>,
  progress?: (done: number) => void): Promise<{ tally: InvitationTally; fatal?: number }> {
  const tally: InvitationTally = { sent: 0, saved: 0, throttled: 0, failed: 0, invalid, existing: 0, other: 0 };
  for (const [index, email] of addresses.slice(0, INVITATION_BULK_MAX).entries()) {
    const result = await invite(email);
    if (typeof result === "object") return { tally, fatal: result.fatal };
    if (result === "sent") tally.sent += 1;
    else if (result === "off") tally.saved += 1;
    else if (result === "throttled") tally.throttled += 1;
    else if (result === "failed") tally.failed += 1;
    else if (result === "existing") tally.existing += 1;
    else tally.other += 1;
    progress?.(index + 1);
  }
  return { tally };
}

/** Statusar som gäller alla adresser: utloggad, inte behörig, för stor begäran. */
export const fatalStatus = (status: number) => status === 401 || status === 403 || status === 404;
