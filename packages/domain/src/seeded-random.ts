/**
 * Deterministisk slump med frö för lottning av starttider och gafflingar.
 * Samma frö ger alltid samma följd; fröet sparas för revision men visas aldrig.
 */
export const MAX_UINT32 = 4_294_967_295;

function nextXorshift32(state: number): number {
  let next = state >>> 0;
  next ^= next << 13; next >>>= 0;
  next ^= next >>> 17; next >>>= 0;
  next ^= next << 5;
  return next >>> 0;
}

/** Slumptalsgenerator med fröet; ger heltal i [0, bound) utan skevhet. */
export function createRandom(seed: number) {
  let state = seed >>> 0;
  return (bound: number): number => {
    const limit = Math.floor(MAX_UINT32 / bound) * bound;
    let value: number;
    do { state = nextXorshift32(state); value = state - 1; } while (value >= limit);
    return value % bound;
  };
}

export function shuffle<T>(items: readonly T[], random: (bound: number) => number): T[] {
  const result = [...items];
  for (let last = result.length - 1; last > 0; last -= 1) {
    const pick = random(last + 1);
    const value = result[last]!;
    result[last] = result[pick]!;
    result[pick] = value;
  }
  return result;
}
