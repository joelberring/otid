/** Små hjälpfunktioner för Mapper-XML tolkad med fast-xml-parser (attribut med prefixet "@"). */

export type XmlNode = Record<string, unknown>;

export function asArray(value: unknown): XmlNode[] {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter((item): item is XmlNode => typeof item === "object" && item !== null);
}

export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return asArray(node?.[name])[0];
}

export function attr(node: XmlNode | undefined, name: string): string | undefined {
  const value = node?.[`@${name}`];
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;
}

export function num(node: XmlNode | undefined, name: string, fallback: number): number {
  const text = attr(node, name);
  if (text === undefined) return fallback;
  const value = Number(text);
  return Number.isFinite(value) ? value : fallback;
}

export function bool(node: XmlNode | undefined, name: string): boolean {
  return attr(node, name) === "true";
}

/** Textinnehållet i ett element (fast-xml-parser lägger det i "#text" när elementet har attribut). */
export function text(node: unknown): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (typeof node === "object" && node !== null) {
    const value = (node as XmlNode)["#text"];
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
  }
  return "";
}

const ENTITIES: Readonly<Record<string, string>> = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" };

/** Avkodar XML-entiteter i text som lästs utan parser. */
export function decodeEntities(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, name: string) => {
    if (name.startsWith("#x")) return safeCodePoint(Number.parseInt(name.slice(2), 16)) ?? whole;
    if (name.startsWith("#")) return safeCodePoint(Number.parseInt(name.slice(1), 10)) ?? whole;
    return ENTITIES[name] ?? whole;
  });
}

function safeCodePoint(code: number): string | undefined {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : undefined;
}

/** Attributen i en starttagg, t.ex. `<object type="1" symbol="3">`. */
export function tagAttributes(tag: string): Map<string, string> {
  const result = new Map<string, string>();
  const pattern = /([A-Za-z_][\w.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (let match = pattern.exec(tag); match; match = pattern.exec(tag)) {
    result.set(match[1]!, decodeEntities(match[2] ?? match[3] ?? ""));
  }
  return result;
}
