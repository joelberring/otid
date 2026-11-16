/**
 * Ägaren 2026-11-16 («se över så att det inte drar för mycket»): verktygens svar som JSON där tal och koordinater står på
 * en rad. Med vanlig indragning hamnar varje koordinat på tre–fyra egna rader, och ett svar med geometri blir flera gånger
 * längre än det behöver vara för den som läser det (en språkmodell betalar för varje rad). Strukturen (objekt och listor av
 * objekt) är fortfarande indragen, så svaret går att läsa; det är giltig JSON som förut.
 */
const flat = (value: unknown): boolean => value === null || typeof value !== "object"
  || (Array.isArray(value) && value.every(item => item === null || typeof item !== "object" || (Array.isArray(item) && item.every(inner => inner === null || typeof inner !== "object"))));

function write(value: unknown, indent: string): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    // Listor av tal, texter eller koordinatpar: en rad.
    if (flat(value)) return JSON.stringify(value);
    const inner = `${indent} `;
    return `[\n${value.map(item => `${inner}${write(item === undefined ? null : item, inner)}`).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined && typeof item !== "function");
  if (entries.length === 0) return "{}";
  const inner = `${indent} `;
  return `{\n${entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${write(item, inner)}`).join(",\n")}\n${indent}}`;
}

/** Ett verktygssvar som text: en text som den är, annat som kompakt indragen JSON. */
export const mcpText = (value: unknown): string => typeof value === "string" ? value : write(value, "");
