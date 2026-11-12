/**
 * En säker returadress: bara en sökväg på samma webbplats. Den börjar med ett enkelt "/" (inte "//" eller "/\", som
 * webbläsaren läser som en annan värd), har inget schema eller värdnamn och inga styrtecken eller blanksteg. Används av
 * språkbytets `tillbaka` (app/sprak/route.ts) och returen efter inloggningen (`after-login.ts`, användartestet 2026-11-12).
 */
export function isSafeReturnPath(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0 || path.length > 2000) return false;
  if (!/^\/(?![/\\])/.test(path)) return false;
  // Inga styrtecken, blanksteg eller omvända snedstreck (webbläsare gör "\" till "/").
  return !/[\u0000- \u007f\\]/.test(path);
}

/** Sidor som inloggningen skickar tillbaka till: tävlingens sidor och undersidorna under Mina tävlingar. */
export function isLoginReturnPath(path: unknown): path is string {
  return isSafeReturnPath(path) && /^\/(?:admin\/[^/?#]+|organizer\/[^?#]+)(?:[/?#]|$)/.test(path);
}
