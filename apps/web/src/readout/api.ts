import { readoutPackageSchema, type ReadoutPackage } from "@o-tid/contracts";

const ORGANIZER_CSRF = { loopback: "otid_organizer_csrf", secure: "__Host-otid-organizer-csrf" } as const;
const RACE_ADMIN_CSRF = { loopback: "otid_race_administrator_csrf", secure: "__Host-otid-race-administrator-csrf" } as const;

function readCookie(names: { loopback: string; secure: string }, cookieText = document.cookie, url = new URL(window.location.href)): string | undefined {
  const loopback = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const name = loopback ? names.loopback : names.secure;
  const values = cookieText.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return undefined;
  const value = values[0]!.slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}

export const raceAdminCsrf = () => readCookie(RACE_ADMIN_CSRF);

export type PackageOutcome =
  | { readonly kind: "ok"; readonly value: ReadoutPackage }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "offline" }
  | { readonly kind: "failed"; readonly status: number };

export async function fetchReadoutPackage(raceId: string): Promise<PackageOutcome> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/races/${encodeURIComponent(raceId)}/administrator/readout-package`, {
      credentials: "same-origin", cache: "no-store"
    });
  } catch {
    return { kind: "offline" };
  }
  if (response.status === 401 || response.status === 403) return { kind: "unauthorized" };
  if (!response.ok) return { kind: "failed", status: response.status };
  const value = readoutPackageSchema.parse(await response.json());
  if (value.raceId !== raceId) throw new Error("Avläsningspaketet gäller ett annat lopp");
  return { kind: "ok", value };
}

/**
 * Öppnar tävlingen med det inloggade kontot (OWNER/ADMIN). Ger en ny
 * administratörssession; kontosessionen räcker i 30 dagar.
 */
export async function enterRace(raceId: string): Promise<boolean> {
  const csrf = readCookie(ORGANIZER_CSRF);
  if (!csrf) return false;
  try {
    const response = await fetch(`/api/organizer/races/${encodeURIComponent(raceId)}/enter`, {
      method: "POST", credentials: "same-origin", cache: "no-store", headers: { "x-otid-csrf": csrf }
    });
    return response.ok;
  } catch {
    return false;
  }
}
