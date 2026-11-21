import { sql } from "drizzle-orm";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0229 (PLAN.md steg M1): installationens inställningar som superadmin ändrar på superadminsidan, i tabellen
 * `installation_setting` (migration 0133). Ingen rad = förvalet ur miljön. Inställningen går före miljövariabeln, eftersom den
 * är det senaste beslutet och görs av den som driver servern.
 *
 * - `cache_max_mb`: mellanlagrets tak (förval `OTID_CACHE_MAX_MB`, annars 10 240 MB).
 * - `map_quota_total_mb`: kartlagringens totala gräns för installationen (förval `OTID_MAP_QUOTA_TOTAL_MB`; 0 = ingen gräns).
 * - `pin_max_mb` (PLAN.md steg M2): gränsen för det som spikats fast för tävlingar och träningar (förval 3 072 MB). Det
 *   fastspikade räknas utanför taket; passeras gränsen spikas det ändå, men superadminsidan och loggen varnar.
 */
export const DEFAULT_CACHE_MAX_MB = 10_240;
export const DEFAULT_PIN_MAX_MB = 3072;
export const CACHE_MAX_MB_RANGE = { min: 100, max: 10_000_000 } as const;
const MB = 1024 * 1024;

export interface InstallationSettings {
  /** Satt av superadmin, eller null = förvalet. */
  readonly cacheMaxMb: number | null;
  readonly mapQuotaTotalMb: number | null;
  /** Satt av superadmin, eller null = förvalet (`DEFAULT_PIN_MAX_MB`). Saknas i äldre anrop = förvalet. */
  readonly pinMaxMb?: number | null;
}

type Env = Partial<Record<string, string | undefined>>;

/** Mellanlagrets förval: `OTID_CACHE_MAX_MB` om det är ett heltal inom gränserna, annars 10 240 MB. */
export function defaultCacheMaxMb(env: Env = process.env): number {
  const value = env.OTID_CACHE_MAX_MB?.trim();
  const parsed = value && /^\d+$/.test(value) ? Number(value) : NaN;
  return parsed >= CACHE_MAX_MB_RANGE.min && parsed <= CACHE_MAX_MB_RANGE.max ? parsed : DEFAULT_CACHE_MAX_MB;
}

export function cacheSettingProblems(env: Env): string[] {
  const value = env.OTID_CACHE_MAX_MB?.trim();
  if (!value) return [];
  return defaultCacheMaxMb(env) === Number(value) ? []
    : [`OTID_CACHE_MAX_MB ska vara ett heltal mellan ${CACHE_MAX_MB_RANGE.min} och ${CACHE_MAX_MB_RANGE.max} (MB); förvalet ${DEFAULT_CACHE_MAX_MB} används`];
}

export type InstallationSettingKey = "cache_max_mb" | "map_quota_total_mb" | "pin_max_mb";

const integerOrNull = (value: unknown): number | null => typeof value === "number" && Number.isInteger(value) ? value : null;

export async function readInstallationSettings(tx: DbExecutor): Promise<InstallationSettings> {
  const rows = (await tx.execute<{ key: string; value: unknown }>(sql`select key, value from installation_setting
    where key in ('cache_max_mb', 'map_quota_total_mb', 'pin_max_mb')`)).rows;
  const value = (key: string) => integerOrNull(rows.find(row => row.key === key)?.value);
  return { cacheMaxMb: value("cache_max_mb"), mapQuotaTotalMb: value("map_quota_total_mb"), pinMaxMb: value("pin_max_mb") };
}

/** Sparar eller tar bort (null = förvalet) en inställning. Anroparen kontrollerar behörigheten och loggar. */
export async function writeInstallationSetting(tx: DbExecutor, key: InstallationSettingKey, value: number | null,
  accountId: string | null, now: Date): Promise<void> {
  if (value === null) {
    await tx.execute(sql`delete from installation_setting where key = ${key}`);
    return;
  }
  await tx.execute(sql`insert into installation_setting (key, value, updated_at, updated_by)
    values (${key}, ${JSON.stringify(value)}::jsonb, ${now}, ${accountId}::uuid)
    on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`);
}

/** Mellanlagrets gällande tak i byte. */
export const cacheMaxBytes = (settings: InstallationSettings, env: Env = process.env) => (settings.cacheMaxMb ?? defaultCacheMaxMb(env)) * MB;

/** Gränsen för det fastspikade i byte (PLAN.md steg M2). */
export const pinMaxBytes = (settings: InstallationSettings) => (settings.pinMaxMb ?? DEFAULT_PIN_MAX_MB) * MB;
