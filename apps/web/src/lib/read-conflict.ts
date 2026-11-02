/**
 * Steg 51 (lasttest): läsningar i en transaktion med upprepbar läsning kan avbrytas av PostgreSQL när en funktionär ändrar
 * tävlingen samtidigt (40001 serialiseringsfel, 40P01 dödläge). En läsning har inga sidoeffekter och kan göras om.
 * Översynen 2026-11-02: samma sak för skrivningar. Ett avbrutet försök har rullats tillbaka helt, och skrivningarna är
 * idempotenta på begärans id, så hela åtgärden görs om (högst tre försök).
 */
export function isRetryableReadConflict(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 4; current = (current as { cause?: unknown }).cause, depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (code === "40001" || code === "40P01") return true;
  }
  return false;
}

const ATTEMPTS = 3;

/** Gör om en läsning som avbrutits av en samtidig ändring, högst tre försök. */
export async function retryReadConflicts<T>(read: () => Promise<T>): Promise<T> {
  return retryTransactionConflicts(read);
}

/**
 * Gör om en åtgärd vid 40001/40P01, högst tre försök med växande väntan (med lite slump så att två krockande
 * försök inte krockar igen). `attempt` börjar på 1.
 */
export async function retryTransactionConflicts<T>(run: (attempt: number) => Promise<T>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try { return await run(attempt); } catch (error) {
      if (attempt >= ATTEMPTS || !isRetryableReadConflict(error)) throw error;
      await wait(50 * attempt + Math.floor(Math.random() * 50));
    }
  }
}
