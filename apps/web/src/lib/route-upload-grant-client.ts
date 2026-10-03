const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash = /^[a-f0-9]{64}$/;
export const routeUploadGrantLifetimes = [1, 7, 30] as const;
export type RouteUploadGrantLifetimeDays = typeof routeUploadGrantLifetimes[number];

export type RouteUploadGrantMaterial = {
  grantId: string;
  entryId: string;
  secret: Uint8Array;
  secretHash: string;
  expiresAt: string;
};

function hex(bytes: Uint8Array): string {
  return [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
}

export async function createRouteUploadGrantMaterial(
  entryId: string, lifetimeDays: RouteUploadGrantLifetimeDays, now = new Date(), webCrypto: Crypto = globalThis.crypto
): Promise<RouteUploadGrantMaterial> {
  if (!uuid.test(entryId) || !routeUploadGrantLifetimes.includes(lifetimeDays) || !Number.isFinite(now.getTime())) throw new Error("Ogiltigt länkmaterial");
  const grantId = webCrypto.randomUUID();
  if (!uuid.test(grantId)) throw new Error("Web Crypto gav ett ogiltigt grant-id");
  const secret = webCrypto.getRandomValues(new Uint8Array(32));
  const secretHash = hex(new Uint8Array(await webCrypto.subtle.digest("SHA-256", secret)));
  if (!hash.test(secretHash)) throw new Error("Web Crypto gav en ogiltig hash");
  return { grantId, entryId, secret, secretHash, expiresAt: new Date(now.getTime() + lifetimeDays * 86_400_000).toISOString() };
}

export function routeUploadGrantLink(material: RouteUploadGrantMaterial, origin: string): string {
  if (!uuid.test(material.grantId) || material.secret.length !== 32 || !hash.test(material.secretHash)) throw new Error("Ogiltigt länkmaterial");
  const base = new URL(origin);
  if (base.origin !== origin || base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw new Error("Ogiltig webb-origin");
  return new URL(`/route-upload/${material.grantId}/${btoa(String.fromCharCode(...material.secret)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`, base).toString();
}

export function clearRouteUploadGrantMaterial(material: RouteUploadGrantMaterial): void { material.secret.fill(0); }
