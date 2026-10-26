/**
 * Steg 54 (ADR-0177): en tung läsning i arbetsytan som flera skärmar gör samtidigt (Kvar i skogen hos speakern och
 * funktionärerna) räknas en gång per tävling och `ttlMs` och delas. Anroparen har redan kontrollerat behörigheten; bara
 * innehåll som är detsamma för alla med behörighet får delas så här. Ett fel delas inte.
 */
export function createSharedRead(ttlMs: number, now: () => number = Date.now, maxEntries = 200) {
  const entries = new Map<string, { at: number; value: Promise<unknown> }>();
  return <T>(key: string, compute: () => Promise<T>): Promise<T> => {
    const known = entries.get(key);
    if (known && now() - known.at < ttlMs) return known.value as Promise<T>;
    const value = compute();
    entries.set(key, { at: now(), value });
    value.catch(() => { if (entries.get(key)?.value === value) entries.delete(key); });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    return value;
  };
}
