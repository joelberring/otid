/**
 * Användartestet 2026-11-12: varför en tävlingssida inte öppnas. Kontosessionen (`/api/organizer/session`) avgör läget:
 * inte inloggad, inloggad med obekräftad adress (en inbjudan gäller först när adressen är bekräftad, ADR-0186) eller
 * inloggad utan behörighet. Om en inbjudan väntar sägs inte: det skulle visa vem som bjudits in till tävlingen för den som
 * registrerat någon annans adress utan att ha bekräftat den.
 */
export type AccessSituation =
  | { kind: "signed-out" }
  | { kind: "unverified"; email: string }
  | { kind: "no-access"; email: string };

export function accessSituation(session: { email: string; emailVerified?: boolean | undefined } | undefined): AccessSituation {
  if (!session) return { kind: "signed-out" };
  return session.emailVerified === false ? { kind: "unverified", email: session.email } : { kind: "no-access", email: session.email };
}
