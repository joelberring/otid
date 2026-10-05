import { headers } from "next/headers";

/**
 * Webbplatsens publika adress för länkar som lämnar sidan (QR-kod, delning): O_TID_PUBLIC_ORIGIN i drift,
 * annars värden som begäran kom till (lokal utveckling).
 */
export async function publicOrigin(): Promise<string> {
  const configured = process.env.O_TID_PUBLIC_ORIGIN;
  if (configured) return new URL(configured).origin;
  const request = await headers();
  const host = request.get("host");
  if (!host) throw new Error("O_TID_PUBLIC_ORIGIN saknas och begäran har ingen värd");
  return `${request.get("x-forwarded-proto") === "https" ? "https" : "http"}://${host}`;
}
