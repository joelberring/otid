import { WMM_2025, WMM_EPOCH, WMM_VALID_UNTIL } from "./wmm-coefficients";

/**
 * ADR-0223: magnetisk missvisning med World Magnetic Model 2025. `magneticDeclination` ger grader, östlig positiv, för en
 * plats (WGS 84) och ett datum. Utanför modellens giltighet (2025–2030) räknas den ändå med den årliga ändringen, men
 * `valid` säger att värdet är osäkrare; före 2025 ger modellen inte historiska värden (`valid` false).
 */
const MAX_DEGREE = 12;
/** WMM:s referensradie för fältet (km) och WGS 84-ellipsoiden. */
const FIELD_RADIUS_KM = 6371.2;
const A_KM = 6378.137;
const FLATTENING = 1 / 298.257223563;
const E2 = FLATTENING * (2 - FLATTENING);
const RAD = Math.PI / 180;

/** Decimalt år för ett datum (ÅÅÅÅ-MM-DD eller Date), t.ex. 2026-07-02 → 2026,5. */
export function decimalYear(date: string | Date): number {
  const at = typeof date === "string" ? new Date(`${date}T12:00:00Z`) : date;
  const year = at.getUTCFullYear();
  const start = Date.UTC(year, 0, 1), end = Date.UTC(year + 1, 0, 1);
  return year + (at.getTime() - start) / (end - start);
}

export interface Declination {
  /** Grader, östlig positiv. */
  readonly degrees: number;
  /** Inom modellens giltighet (2025.0–2030.0). */
  readonly valid: boolean;
}

/** Missvisningen på en plats och höjd (km över ellipsoiden) ett visst år (decimalt). */
export function magneticDeclination(latitude: number, longitude: number, year: number, heightKm = 0): Declination {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(year) || Math.abs(latitude) > 89.99) {
    throw new RangeError("Ogiltig plats eller tid för missvisningen");
  }
  const phi = latitude * RAD, lambda = longitude * RAD;
  // Geodetiskt till geocentriskt sfäriskt.
  const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
  const rc = A_KM / Math.sqrt(1 - E2 * sinPhi * sinPhi);
  const p = (rc + heightKm) * cosPhi, z = (rc * (1 - E2) + heightKm) * sinPhi;
  const r = Math.hypot(p, z);
  const phiC = Math.asin(z / r);
  const x = Math.sin(phiC), s = Math.cos(phiC);

  // Schmidt-semi-normerade Legendre-funktioner P[n][m](sin φ') och derivatan mot θ (kolatituden).
  const P: number[][] = Array.from({ length: MAX_DEGREE + 1 }, () => new Array<number>(MAX_DEGREE + 1).fill(0));
  const dP: number[][] = Array.from({ length: MAX_DEGREE + 1 }, () => new Array<number>(MAX_DEGREE + 1).fill(0));
  P[0]![0] = 1;
  for (let n = 1; n <= MAX_DEGREE; n += 1) {
    P[n]![n] = n === 1 ? s : Math.sqrt((2 * n - 1) / (2 * n)) * s * P[n - 1]![n - 1]!;
    for (let m = 0; m < n; m += 1) {
      const previous = n - 2 >= m ? P[n - 2]![m]! : 0;
      P[n]![m] = ((2 * n - 1) * x * P[n - 1]![m]! - Math.sqrt((n - 1 + m) * (n - 1 - m)) * previous) / Math.sqrt(n * n - m * m);
    }
  }
  for (let n = 1; n <= MAX_DEGREE; n += 1) {
    for (let m = 0; m <= n; m += 1) {
      const lower = n - 1 >= m ? P[n - 1]![m]! : 0;
      dP[n]![m] = (n * x * P[n]![m]! - Math.sqrt((n + m) * (n - m)) * lower) / s;
    }
  }

  const dt = year - WMM_EPOCH;
  let north = 0, east = 0, down = 0;
  for (const [n, m, g0, h0, gDot, hDot] of WMM_2025) {
    const g = g0 + dt * gDot, h = h0 + dt * hDot;
    const ratio = (FIELD_RADIUS_KM / r) ** (n + 2);
    const cos = Math.cos(m * lambda), sin = Math.sin(m * lambda);
    const along = g * cos + h * sin;
    north += ratio * along * dP[n]![m]!;
    east += ratio * m * (g * sin - h * cos) * P[n]![m]! / s;
    down -= (n + 1) * ratio * along * P[n]![m]!;
  }
  // Tillbaka till ellipsoidens riktningar (vridningen mellan geocentrisk och geodetisk latitud).
  const tilt = phiC - phi;
  const X = north * Math.cos(tilt) - down * Math.sin(tilt);
  const degrees = Math.atan2(east, X) / RAD;
  return { degrees, valid: year >= WMM_EPOCH && year <= WMM_VALID_UNTIL };
}
