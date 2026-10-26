/**
 * Steg 51 (lasttest): läsningar i en transaktion med upprepbar läsning kan avbrytas av PostgreSQL när en funktionär ändrar
 * tävlingen samtidigt (40001 serialiseringsfel, 40P01 dödläge). En läsning har inga sidoeffekter och kan göras om.
 */
export function isRetryableReadConflict(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 4; current = (current as { cause?: unknown }).cause, depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (code === "40001" || code === "40P01") return true;
  }
  return false;
}

/** Gör om en läsning som avbrutits av en samtidig ändring, högst tre försök. */
export async function retryReadConflicts<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try { return await read(); } catch (error) {
      if (attempt >= 3 || !isRetryableReadConflict(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
}
