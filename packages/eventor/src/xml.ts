import { XMLParser, XMLValidator } from "fast-xml-parser";
import { EventorAdapterError, type EventorAdapterErrorCode } from "./errors";

/**
 * Härdad XML-läsning för Eventors svar: ingen DTD, inga okända entiteter, begränsad
 * storlek, nästning och antal noder. Fälten läses sedan toleranta (okända element
 * ignoreras) eftersom Eventor lägger till element över tid.
 */
export const MAX_XML_BYTES = 8 * 1024 * 1024;
const MAX_XML_NESTING = 64;
const MAX_XML_NODES = 600_000;
const FORBIDDEN_DECLARATION = /<!\s*(?:DOCTYPE|DTD|ENTITY)\b/i;
// eslint-disable-next-line no-control-regex -- IDs/names reject C0/C1 controls rather than normalize them.
const FORBIDDEN_TEXT_CHARACTER = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f]");

export type XmlRecord = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  trimValues: true,
  cdataPropName: "#cdata"
});

export function fail(code: EventorAdapterErrorCode): never {
  throw new EventorAdapterError(code);
}

export function record(value: unknown): XmlRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as XmlRecord : undefined;
}

export function many(value: unknown): readonly unknown[] {
  if (value === undefined || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

/** Textinnehållet i ett element (med eller utan attribut), eller undefined om det saknas/är tomt. */
export function textOf(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.length === 1 ? textOf(value[0]) : undefined;
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).replace(/\s+/g, " ").trim();
    return text === "" ? undefined : text;
  }
  const valueRecord = record(value);
  if (!valueRecord) return undefined;
  return textOf(valueRecord["#text"] ?? valueRecord["#cdata"]);
}

/** Ett attributvärde, t.ex. `eventForm` eller `value`. */
export function attribute(value: unknown, name: string): string | undefined {
  const valueRecord = record(Array.isArray(value) ? value[0] : value);
  const raw = valueRecord?.[`@_${name}`];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
}

/** Ett opakt externt id (Eventors id är text utan längdregel; vi kräver 1–64 tecken utan styrtecken). */
export function externalId(value: unknown): string {
  const id = textOf(value);
  if (!id || id.length > 64 || FORBIDDEN_TEXT_CHARACTER.test(id)) fail("INVALID_XML");
  return id;
}

export function optionalExternalId(value: unknown): string | undefined {
  return textOf(value) === undefined ? undefined : externalId(value);
}

/** Namn och klubbar: 1–160 tecken utan styrtecken. */
export function displayText(value: unknown): string {
  const text = textOf(value);
  if (!text || text.length > 160 || FORBIDDEN_TEXT_CHARACTER.test(text)) fail("INVALID_XML");
  return text;
}

export function optionalDisplayText(value: unknown): string | undefined {
  return textOf(value) === undefined ? undefined : displayText(value);
}

const DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

/** Eventors `<Date>`/`<Clock>`-par. Klockslaget saknar tidszon och tolkas av appen. */
export function dateTime(value: unknown): { date: string; clock?: string } {
  const temporal = record(Array.isArray(value) ? value[0] : value);
  const date = textOf(temporal?.Date);
  if (!temporal || !date || !DATE.test(date)) fail("INVALID_XML");
  const clock = textOf(temporal.Clock);
  if (clock !== undefined && !CLOCK.test(clock)) fail("INVALID_XML");
  return clock === undefined ? { date } : { date, clock: clock.length === 5 ? `${clock}:00` : clock };
}

function isXmlCharacter(codePoint: number): boolean {
  return codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd
    || (codePoint >= 0x20 && codePoint <= 0xd7ff)
    || (codePoint >= 0xe000 && codePoint <= 0xfffd)
    || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
}

function validateXmlCharacters(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) fail("INVALID_XML");
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff || !isXmlCharacter(codeUnit)) fail("INVALID_XML");
  }
}

function validateXmlReferences(value: string): void {
  let offset = 0;
  while (offset < value.length) {
    const ampersand = value.indexOf("&", offset);
    if (ampersand === -1) return;
    const semicolon = value.indexOf(";", ampersand + 1);
    if (semicolon === -1 || semicolon - ampersand > 16) fail("INVALID_XML");
    const reference = value.slice(ampersand + 1, semicolon);
    if (!["amp", "lt", "gt", "quot", "apos"].includes(reference)) {
      if (!/^#(?:x[0-9a-fA-F]+|[0-9]+)$/.test(reference)) fail("INVALID_XML");
      const codePoint = Number(reference.startsWith("#x") ? `0x${reference.slice(2)}` : reference.slice(1));
      if (!Number.isInteger(codePoint) || !isXmlCharacter(codePoint)) fail("INVALID_XML");
    }
    offset = semicolon + 1;
  }
}

function markupEnd(value: string, start: number): number {
  let quote: "\"" | "'" | undefined;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === "\"" || character === "'") quote = character;
    else if (character === ">") return index;
  }
  fail("INVALID_XML");
}

/** Räknar noder och nästning och kontrollerar entitetsreferenser innan XML-tolken körs. */
function validateXmlComplexity(value: string): void {
  let nesting = 0;
  let nodes = 0;
  let index = 0;
  while (index < value.length) {
    const tagStart = value.indexOf("<", index);
    if (tagStart === -1) {
      validateXmlReferences(value.slice(index));
      return;
    }
    validateXmlReferences(value.slice(index, tagStart));
    const skipTo = (marker: string, from: number) => {
      const end = value.indexOf(marker, from);
      if (end === -1) fail("INVALID_XML");
      return end + marker.length;
    };
    if (value.startsWith("<!--", tagStart)) { index = skipTo("-->", tagStart + 4); continue; }
    if (value.startsWith("<![CDATA[", tagStart)) { index = skipTo("]]>", tagStart + 9); continue; }
    if (value.startsWith("<?", tagStart)) { index = skipTo("?>", tagStart + 2); continue; }
    const end = markupEnd(value, tagStart + 1);
    const markup = value.slice(tagStart + 1, end);
    for (let attr = 0; attr < markup.length; attr += 1) {
      const quote = markup[attr];
      if (quote !== "\"" && quote !== "'") continue;
      const quoteEnd = markup.indexOf(quote, attr + 1);
      if (quoteEnd === -1) fail("INVALID_XML");
      validateXmlReferences(markup.slice(attr + 1, quoteEnd));
      attr = quoteEnd;
    }
    const next = value[tagStart + 1];
    if (next === "!") { index = end + 1; continue; }
    nodes += 1;
    if (nodes > MAX_XML_NODES) fail("RESPONSE_TOO_LARGE");
    if (next === "/") {
      nesting -= 1;
      if (nesting < 0) fail("INVALID_XML");
    } else if (value[end - 1] !== "/") nesting += 1;
    if (nesting > MAX_XML_NESTING) fail("INVALID_XML");
    index = end + 1;
  }
}

/** Tolkar ett helt dokument och ger rotelementet, som måste heta `rootName`. */
export function parseDocument(xml: string, rootName: string): XmlRecord {
  if (typeof xml !== "string") fail("INVALID_INPUT");
  if (FORBIDDEN_DECLARATION.test(xml)) fail("INVALID_XML");
  if (new TextEncoder().encode(xml).byteLength > MAX_XML_BYTES) fail("RESPONSE_TOO_LARGE");
  const body = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
  validateXmlCharacters(body);
  validateXmlComplexity(body);
  if (XMLValidator.validate(body) !== true) fail("INVALID_XML");
  let document: XmlRecord | undefined;
  try {
    document = record(parser.parse(body));
  } catch {
    fail("INVALID_XML");
  }
  const elementNames = Object.keys(document ?? {}).filter((key) => key !== "?xml");
  if (!document || elementNames.length !== 1 || elementNames[0] !== rootName) fail("INVALID_XML");
  const root = document[rootName];
  if (root === "") return {};
  const rootRecord = record(root);
  if (!rootRecord) fail("INVALID_XML");
  return rootRecord;
}
