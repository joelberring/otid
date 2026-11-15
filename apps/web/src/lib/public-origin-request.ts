/**
 * Webbplatsens publika adress i en route handler (som `publicOrigin` för sidorna): O_TID_PUBLIC_ORIGIN i drift, annars värden
 * som begäran kom till (lokal utveckling). Används för papperets QR-koder (ägaren 2026-11-16).
 */
export function requestPublicOrigin(request: Request): string | undefined {
  const configured = process.env.O_TID_PUBLIC_ORIGIN;
  if (configured) return new URL(configured).origin;
  const host = request.headers.get("host");
  if (!host) return undefined;
  return `${request.headers.get("x-forwarded-proto") === "https" ? "https" : "http"}://${host}`;
}
