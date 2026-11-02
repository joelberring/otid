/**
 * Paketets uträkningar får inte fälla editorn, men ett fel får inte heller sväljas (översynen 2026-11-02): det loggas,
 * vyn visar det som går, och reservvärdet märks så att editorn kan säga vad som inte gick att räkna fram
 * (`failedName`). Reservvärdet görs nytt varje gång (en fabrik), så att märket bara gäller just det misslyckandet.
 */
const failures = new WeakMap<object, string>();

export function safely<T>(name: string, compute: () => T, fallback: () => T): T {
  try { return compute(); } catch (error) {
    console.error(`${name} misslyckades`, error);
    const value = fallback();
    if (typeof value === "object" && value !== null) failures.set(value, name);
    return value;
  }
}

/** Namnet på uträkningen som misslyckades, om värdet är ett reservvärde från `safely`. */
export function failedName(value: unknown): string | undefined {
  return typeof value === "object" && value !== null ? failures.get(value) : undefined;
}

/** Namnen på det som misslyckades, utan dubbletter, i ordning. */
export function failedNames(values: readonly unknown[], extra: readonly (string | false | undefined)[] = []): string[] {
  return [...new Set([...values.map(failedName), ...extra].filter((name): name is string => typeof name === "string"))];
}
