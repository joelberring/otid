function serializeCanonicalJson(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("Canonical JSON tillåter endast säkra heltal");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError("Värdet kan inte representeras som canonical JSON");
  }

  if (ancestors.has(value)) throw new TypeError("Canonical JSON tillåter inte cykliska värden");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new TypeError("Canonical JSON tillåter inte glesa arrayer");
        items.push(serializeCanonicalJson(value[index], ancestors));
      }
      return `[${items.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON tillåter endast vanliga objekt");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("Canonical JSON tillåter inte symbolnycklar");
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${serializeCanonicalJson(record[key], ancestors)}`
    ).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(serializeCanonicalJson(value, new Set<object>()));
}
