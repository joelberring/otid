/** ADR-0205: om "Logga in med Google" ska visas: både `OTID_GOOGLE_CLIENT_ID` och `OTID_GOOGLE_CLIENT_SECRET` är satta. */
export function googleLoginEnabled(
  environment: Record<string, string | undefined> = process.env
): boolean {
  return !!environment.OTID_GOOGLE_CLIENT_ID?.trim() && !!environment.OTID_GOOGLE_CLIENT_SECRET?.trim();
}
