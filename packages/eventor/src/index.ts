import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";

const MAX_XML_BYTES = 2 * 1024 * 1024;
const MAX_RACES = 1_000;
const MAX_XML_NESTING = 64;
const MAX_XML_NODES = 10_000;
const MAX_ENTRY_IMPORT_XML_NODES = 200_000;
const MAX_EVENT_CLASSES = 500;
const MAX_ENTRIES = 10_000;
const EVENTOR_ORIGIN_BY_PROFILE = {
  "testeventor-se": "https://eventor-sweden-test.orientering.se",
  "production-se": "https://eventor.orientering.se",
} as const;
const FORBIDDEN_DECLARATION = /<!\s*(?:DOCTYPE|DTD|ENTITY)\b/i;
// eslint-disable-next-line no-control-regex -- IDs/names reject C0/C1 controls rather than normalize them.
const FORBIDDEN_TEXT_CHARACTER = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f]");
const VISIBLE_ASCII_32 = /^[\x21-\x7e]{32}$/;
const DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

type XmlRecord = Record<string, unknown>;

export interface EventorEventProjection {
  readonly eventId: string;
  readonly eventName: string;
  readonly startDate: string;
  readonly startClock?: string;
  readonly races: readonly {
    readonly eventRaceId: string;
    readonly raceName: string;
    readonly raceDate: string;
    readonly raceClock?: string;
  }[];
}

export interface EventorEntryImportProjection {
  readonly classes: readonly {
    readonly externalId: string;
    readonly name: string;
  }[];
  readonly entries: readonly {
    readonly externalId: string;
    readonly externalClassId: string;
    readonly givenName: string;
    readonly familyName: string;
    readonly organisationName?: string;
  }[];
}

export type EventorAdapterErrorCode =
  | "INVALID_INPUT"
  | "INVALID_XML"
  | "UPSTREAM_UNAVAILABLE"
  | "RESPONSE_TOO_LARGE"
  | "TIMEOUT";

export class EventorAdapterError extends Error {
  constructor(readonly code: EventorAdapterErrorCode) {
    super(code);
    this.name = "EventorAdapterError";
  }
}

export type EventorProfile = keyof typeof EVENTOR_ORIGIN_BY_PROFILE;

export interface FetchEventorEventInput {
  readonly profile: EventorProfile;
  readonly eventId: string;
  readonly apiKey: string;
}

export interface FetchEventorEventOptions {
  readonly fetch?: typeof fetch;
}

export interface FetchedEventorEvent {
  readonly projection: EventorEventProjection;
  readonly sourceHash: string;
}

export interface FetchedEventorEntryImport {
  readonly projection: EventorEntryImportProjection;
  readonly eventClassesSourceHash: string;
  readonly entriesSourceHash: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  processEntities: true,
  trimValues: false,
  cdataPropName: "#cdata"
});

function fail(code: EventorAdapterErrorCode): never {
  throw new EventorAdapterError(code);
}

function record(value: unknown): XmlRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as XmlRecord : undefined;
}

function exactlyOne(value: unknown): unknown {
  return Array.isArray(value) ? value.length === 1 ? value[0] : undefined : value;
}

function selected(recordValue: XmlRecord, name: string): unknown {
  const value = recordValue[name];
  if (value === undefined || Array.isArray(value)) fail("INVALID_XML");
  return value;
}

function rawText(value: unknown, allowedAttributes: readonly string[] = []): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  const valueRecord = record(value);
  const allowedKeys = new Set(["#text", "_text", "#cdata", ...allowedAttributes]);
  if (!valueRecord || Object.keys(valueRecord).some((key) => !allowedKeys.has(key))) fail("INVALID_XML");
  const nested = exactlyOne(valueRecord["#text"] ?? valueRecord._text ?? valueRecord["#cdata"]);
  if (typeof nested !== "string" && typeof nested !== "number") fail("INVALID_XML");
  return String(nested);
}

function plainText(value: unknown, allowedAttributes: readonly string[] = []): string {
  return rawText(value, allowedAttributes).trim();
}

function opaqueId(value: unknown): string {
  const id = rawText(value);
  if (id.length === 0 || id.length > 256 || FORBIDDEN_TEXT_CHARACTER.test(id) || id !== id.trim() || id === "." || id === "..") fail("INVALID_XML");
  return id;
}

function name(value: unknown): string {
  const parsed = plainText(value, ["@_languageId"]);
  if (parsed.length < 2 || parsed.length > 160 || FORBIDDEN_TEXT_CHARACTER.test(parsed)) fail("INVALID_XML");
  return parsed;
}

function dateTime(value: unknown): { date: string; clock?: string } {
  const temporal = record(value);
  if (!temporal || Object.keys(temporal).some((key) => key !== "Date" && key !== "Clock")) fail("INVALID_XML");
  const dateValue = selected(temporal, "Date");
  const dateAttributes = record(dateValue);
  if (dateAttributes?.["@_dateFormat"] !== undefined && plainText(dateAttributes["@_dateFormat"]) !== "YYYY-MM-DD") fail("INVALID_XML");
  const date = plainText(dateValue, ["@_dateFormat"]);
  if (!DATE.test(date) || date.startsWith("0000-") || !isCalendarDate(date)) fail("INVALID_XML");
  const rawClock = temporal.Clock;
  if (rawClock === undefined) return { date };
  if (Array.isArray(rawClock)) fail("INVALID_XML");
  const clockAttributes = record(rawClock);
  if (clockAttributes?.["@_clockFormat"] !== undefined && plainText(clockAttributes["@_clockFormat"]) !== "HH:MM:SS") fail("INVALID_XML");
  const clock = plainText(rawClock, ["@_clockFormat"]);
  if (!CLOCK.test(clock)) fail("INVALID_XML");
  return { date, clock };
}

function isCalendarDate(value: string): boolean {
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const candidate = new Date(0);
  candidate.setUTCFullYear(year, month - 1, day);
  candidate.setUTCHours(0, 0, 0, 0);
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}

function rejectNamespacesAndNestedRaces(value: unknown, isDirectRace = false): void {
  const object = record(value);
  if (!object) return;
  for (const [key, child] of Object.entries(object)) {
    if (key === "@_xmlns" && String(child) !== "") fail("INVALID_XML");
    if (key.startsWith("@_")) continue;
    if (key.includes(":")) fail("INVALID_XML");
    if (key === "EventRace" && !isDirectRace) fail("INVALID_XML");
    if (Array.isArray(child)) {
      for (const entry of child) rejectNamespacesAndNestedRaces(entry);
    } else {
      rejectNamespacesAndNestedRaces(child);
    }
  }
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

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return true;
  }
  return false;
}

function validateXmlReferences(value: string): void {
  let offset = 0;
  while (offset < value.length) {
    const ampersand = value.indexOf("&", offset);
    if (ampersand === -1) return;
    const semicolon = value.indexOf(";", ampersand + 1);
    if (semicolon === -1 || semicolon - ampersand > 16) fail("INVALID_XML");
    const reference = value.slice(ampersand + 1, semicolon);
    if (["amp", "lt", "gt", "quot", "apos"].includes(reference)) {
      // Built-ins are decoded exactly once by fast-xml-parser after this lexical validation.
    }
    else if (/^#(?:x[0-9a-fA-F]+|[0-9]+)$/.test(reference)) {
      const codePoint = Number(reference.startsWith("#x") ? `0x${reference.slice(2)}` : reference.slice(1));
      if (!Number.isInteger(codePoint) || !isXmlCharacter(codePoint)) fail("INVALID_XML");
    } else fail("INVALID_XML");
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

function validateXmlComplexity(value: string, maxNodes = MAX_XML_NODES): void {
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
    if (value.startsWith("<!--", tagStart)) {
      const end = value.indexOf("-->", tagStart + 4);
      if (end === -1) fail("INVALID_XML");
      index = end + 3;
      continue;
    }
    if (value.startsWith("<![CDATA[", tagStart)) {
      const end = value.indexOf("]]>", tagStart + 9);
      if (end === -1) fail("INVALID_XML");
      index = end + 3;
      continue;
    }
    if (value.startsWith("<?", tagStart)) {
      const end = value.indexOf("?>", tagStart + 2);
      if (end === -1) fail("INVALID_XML");
      index = end + 2;
      continue;
    }
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
    if (next === "!") {
      index = end + 1;
      continue;
    }
    nodes += 1;
    if (nodes > maxNodes) fail("INVALID_XML");
    if (next === "/") {
      nesting -= 1;
      if (nesting < 0) fail("INVALID_XML");
    } else if (value[end - 1] !== "/") nesting += 1;
    if (nesting > MAX_XML_NESTING) fail("INVALID_XML");
    index = end + 1;
  }
}

function parseDocument(xml: string, rootName: string, maxNodes = MAX_XML_NODES): XmlRecord {
  if (FORBIDDEN_DECLARATION.test(xml)) fail("INVALID_XML");
  if (new TextEncoder().encode(xml).byteLength > MAX_XML_BYTES) fail("RESPONSE_TOO_LARGE");
  validateXmlCharacters(xml);
  validateXmlComplexity(xml, maxNodes);
  if (XMLValidator.validate(xml) !== true) fail("INVALID_XML");
  let document: XmlRecord | undefined;
  try {
    document = record(parser.parse(xml));
  } catch {
    fail("INVALID_XML");
  }
  if (!document) fail("INVALID_XML");
  const elementNames = Object.keys(document).filter((key) => key !== "?xml");
  if (elementNames.length !== 1 || elementNames[0] !== rootName || document[rootName] === undefined || Array.isArray(document[rootName])) fail("INVALID_XML");
  return document;
}

export function parseEventorEvent(xml: string): EventorEventProjection {
  if (typeof xml !== "string") fail("INVALID_INPUT");
  const document = parseDocument(xml, "Event");
  const event = record(document.Event);
  if (!event) fail("INVALID_XML");
  rejectNamespacesAndNestedRaces(event, true);
  const eventId = opaqueId(selected(event, "EventId"));
  const eventName = name(selected(event, "Name"));
  const start = dateTime(selected(event, "StartDate"));
  const rawRaces = event.EventRace === undefined ? [] : Array.isArray(event.EventRace) ? event.EventRace : [event.EventRace];
  if (rawRaces.length > MAX_RACES) fail("INVALID_XML");
  const ids = new Set<string>();
  const races = rawRaces.map((rawRace) => {
    const race = record(rawRace);
    if (!race || race.Event !== undefined) fail("INVALID_XML");
    const eventRaceId = opaqueId(selected(race, "EventRaceId"));
    if (ids.has(eventRaceId)) fail("INVALID_XML");
    ids.add(eventRaceId);
    const parentEventId = opaqueId(selected(race, "EventId"));
    if (parentEventId !== eventId) fail("INVALID_XML");
    const raceName = name(selected(race, "Name"));
    const raceTime = dateTime(selected(race, "RaceDate"));
    return raceTime.clock === undefined
      ? { eventRaceId, raceName, raceDate: raceTime.date }
      : { eventRaceId, raceName, raceDate: raceTime.date, raceClock: raceTime.clock };
  });
  return start.clock === undefined
    ? { eventId, eventName, startDate: start.date, races }
    : { eventId, eventName, startDate: start.date, startClock: start.clock, races };
}

function entryText(value: unknown, allowedAttributes: readonly string[] = []): string {
  const parsed = plainText(value, allowedAttributes);
  if (parsed.length < 1 || parsed.length > 160 || FORBIDDEN_TEXT_CHARACTER.test(parsed)) fail("INVALID_XML");
  return parsed;
}

function requiredRecord(value: unknown): XmlRecord {
  const parsed = record(value);
  if (!parsed) fail("INVALID_XML");
  return parsed;
}

function rootRecord(value: unknown): XmlRecord {
  if (value === "") return {};
  return requiredRecord(value);
}

function many(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [value];
}

function rejectEntryImportNamespaces(value: unknown): void {
  const object = record(value);
  if (!object) return;
  for (const [key, child] of Object.entries(object)) {
    if (key === "@_xmlns" || key.startsWith("@_xmlns:") || (!key.startsWith("@_") && key.includes(":"))) fail("INVALID_XML");
    if (Array.isArray(child)) child.forEach(rejectEntryImportNamespaces);
    else rejectEntryImportNamespaces(child);
  }
}

function parseEventClasses(xml: string): readonly { readonly externalId: string; readonly name: string }[] {
  const document = parseDocument(xml, "EventClassList", MAX_ENTRY_IMPORT_XML_NODES);
  const root = rootRecord(document.EventClassList);
  rejectEntryImportNamespaces(root);
  const rawClasses = root.EventClass === undefined ? [] : many(root.EventClass);
  if (rawClasses.length > MAX_EVENT_CLASSES) fail("INVALID_XML");
  const ids = new Set<string>();
  return rawClasses.map((rawClass) => {
    const eventClass = requiredRecord(rawClass);
    const externalId = opaqueId(selected(eventClass, "EventClassId"));
    const className = name(selected(eventClass, "Name"));
    const status = requiredRecord(selected(eventClass, "EventClassStatus"));
    if (Object.keys(status).some((key) => key !== "@_value") || status["@_value"] !== "normal" || ids.has(externalId)) {
      fail("INVALID_XML");
    }
    ids.add(externalId);
    return { externalId, name: className };
  });
}

function parseIndividualEntry(rawEntry: unknown): EventorEntryImportProjection["entries"][number] {
  const entry = requiredRecord(rawEntry);
  const externalId = opaqueId(selected(entry, "EntryId"));
  const competitor = requiredRecord(selected(entry, "Competitor"));
  const person = requiredRecord(selected(competitor, "Person"));
  const personName = requiredRecord(selected(person, "PersonName"));
  const familyName = entryText(selected(personName, "Family"));
  const rawGiven = personName.Given;
  if (rawGiven === undefined) fail("INVALID_XML");
  const givenName = many(rawGiven).map((value) => entryText(value, ["@_sequence"])).join(" ");
  if (givenName.length > 160) fail("INVALID_XML");
  const entryClass = requiredRecord(selected(entry, "EntryClass"));
  const externalClassId = opaqueId(selected(entryClass, "EventClassId"));
  const rawOrganisation = competitor.Organisation;
  if (Array.isArray(rawOrganisation)) fail("INVALID_XML");
  const organisationName = rawOrganisation === undefined
    ? undefined
    : entryText(selected(requiredRecord(rawOrganisation), "Name"));
  return organisationName === undefined
    ? { externalId, externalClassId, givenName, familyName }
    : { externalId, externalClassId, givenName, familyName, organisationName };
}

/**
 * Maps the deliberately small individual subset used by TASK098. It accepts
 * no team entry, alternate class selector, multiple classes, or deleted class.
 * The function retains no raw XML and has no network or database dependency.
 */
export function parseEventorEntryImport(eventClassesXml: string, entriesXml: string): EventorEntryImportProjection {
  if (typeof eventClassesXml !== "string" || typeof entriesXml !== "string") fail("INVALID_INPUT");
  const classes = parseEventClasses(eventClassesXml);
  const classIds = new Set(classes.map((value) => value.externalId));
  const document = parseDocument(entriesXml, "EntryList", MAX_ENTRY_IMPORT_XML_NODES);
  const root = rootRecord(document.EntryList);
  rejectEntryImportNamespaces(root);
  const rawEntries = root.Entry === undefined ? [] : many(root.Entry);
  if (rawEntries.length > MAX_ENTRIES) fail("INVALID_XML");
  const ids = new Set<string>();
  const entries = rawEntries.map(parseIndividualEntry);
  for (const entry of entries) {
    if (ids.has(entry.externalId) || !classIds.has(entry.externalClassId)) fail("INVALID_XML");
    ids.add(entry.externalId);
  }
  return { classes, entries };
}

function validRequestId(eventId: string): boolean {
  return eventId.length > 0 && eventId.length <= 256 && !hasUnpairedSurrogate(eventId) && !FORBIDDEN_TEXT_CHARACTER.test(eventId) && eventId === eventId.trim() && eventId !== "." && eventId !== "..";
}

function isXmlContentType(value: string | null): boolean {
  if (!value) return false;
  return /^(?:application|text)\/(?:[\w.+-]*\+)?xml(?:\s*;|\s*$)/i.test(value.trim());
}

function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  if (body) void body.cancel().catch(() => undefined);
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new EventorAdapterError("TIMEOUT"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new EventorAdapterError("TIMEOUT"));
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", onAbort); reject(error instanceof Error ? error : new Error("upstream failure")); }
    );
  });
}

async function readXmlBody(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_XML_BYTES)) {
    cancelBody(response.body);
    fail("RESPONSE_TOO_LARGE");
  }
  if (!response.body) fail("UPSTREAM_UNAVAILABLE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await awaitWithAbort(reader.read(), signal);
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_XML_BYTES) {
        void reader.cancel().catch(() => undefined);
        fail("RESPONSE_TOO_LARGE");
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof EventorAdapterError) {
      void reader.cancel().catch(() => undefined);
      throw error;
    }
    if (signal.aborted) fail("TIMEOUT");
    fail("UPSTREAM_UNAVAILABLE");
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Cancellation is intentionally not awaited; a pending reader cannot always release synchronously.
    }
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function eventorOrigin(profile: EventorProfile): string {
  return EVENTOR_ORIGIN_BY_PROFILE[profile];
}

function validProfile(value: unknown): value is EventorProfile {
  return value === "testeventor-se" || value === "production-se";
}

async function fetchEventorXml(profile: EventorProfile, path: string, apiKey: string, fetchImplementation: typeof fetch, signal: AbortSignal): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await awaitWithAbort(fetchImplementation(`${eventorOrigin(profile)}${path}`, {
      method: "GET",
      headers: { ApiKey: apiKey, Accept: "application/xml, text/xml;q=0.9" },
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
      signal
    }), signal);
  } catch {
    if (signal.aborted) fail("TIMEOUT");
    fail("UPSTREAM_UNAVAILABLE");
  }
  if (!response.ok || !isXmlContentType(response.headers.get("content-type"))) {
    cancelBody(response.body);
    fail("UPSTREAM_UNAVAILABLE");
  }
  return readXmlBody(response, signal);
}

export async function fetchEventorEvent(
  input: FetchEventorEventInput,
  options: FetchEventorEventOptions = {}
): Promise<FetchedEventorEvent> {
  if (!input || !validProfile(input.profile) || typeof input.eventId !== "string" || typeof input.apiKey !== "string" || !validRequestId(input.eventId) || input.apiKey.length !== 32 || !VISIBLE_ASCII_32.test(input.apiKey)) {
    fail("INVALID_INPUT");
  }
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") fail("UPSTREAM_UNAVAILABLE");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    let response: Response;
    try {
      response = await awaitWithAbort(fetchImplementation(`${eventorOrigin(input.profile)}/api/event/${encodeURIComponent(input.eventId)}`, {
        method: "GET",
        headers: { ApiKey: input.apiKey, Accept: "application/xml, text/xml;q=0.9" },
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal
      }), controller.signal);
    } catch {
      if (controller.signal.aborted) fail("TIMEOUT");
      fail("UPSTREAM_UNAVAILABLE");
    }
    if (!response.ok || !isXmlContentType(response.headers.get("content-type"))) {
      cancelBody(response.body);
      fail("UPSTREAM_UNAVAILABLE");
    }
    const bytes = await readXmlBody(response, controller.signal);
    let xml: string;
    try {
      xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      fail("INVALID_XML");
    }
    const projection = parseEventorEvent(xml);
    if (projection.eventId !== input.eventId) fail("INVALID_XML");
    return { projection, sourceHash: createHash("sha256").update(bytes).digest("hex") };
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

/** Reads exactly the two Eventor sources used by TASK098; neither is persisted here. */
export async function fetchEventorEntryImport(
  input: FetchEventorEventInput,
  options: FetchEventorEventOptions = {}
): Promise<FetchedEventorEntryImport> {
  if (!input || !validProfile(input.profile) || typeof input.eventId !== "string" || typeof input.apiKey !== "string" || !validRequestId(input.eventId) || input.apiKey.length !== 32 || !VISIBLE_ASCII_32.test(input.apiKey)) {
    fail("INVALID_INPUT");
  }
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") fail("UPSTREAM_UNAVAILABLE");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const eventId = encodeURIComponent(input.eventId);
    const eventClassesBytes = await fetchEventorXml(input.profile, `/api/eventclasses?eventId=${eventId}`, input.apiKey, fetchImplementation, controller.signal);
    const entriesBytes = await fetchEventorXml(input.profile, `/api/entries?eventIds=${eventId}`, input.apiKey, fetchImplementation, controller.signal);
    let eventClassesXml: string, entriesXml: string;
    try {
      eventClassesXml = new TextDecoder("utf-8", { fatal: true }).decode(eventClassesBytes);
      entriesXml = new TextDecoder("utf-8", { fatal: true }).decode(entriesBytes);
    } catch {
      fail("INVALID_XML");
    }
    return {
      projection: parseEventorEntryImport(eventClassesXml, entriesXml),
      eventClassesSourceHash: createHash("sha256").update(eventClassesBytes).digest("hex"),
      entriesSourceHash: createHash("sha256").update(entriesBytes).digest("hex")
    };
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

/** Compatibility wrappers for the already verified synthetic Testeventor flow. */
export async function fetchTesteventorEvent(
  input: Omit<FetchEventorEventInput, "profile">,
  options: FetchEventorEventOptions = {}
): Promise<FetchedEventorEvent> {
  return fetchEventorEvent({ ...input, profile: "testeventor-se" }, options);
}

export async function fetchTesteventorEntryImport(
  input: Omit<FetchEventorEventInput, "profile">,
  options: FetchEventorEventOptions = {}
): Promise<FetchedEventorEntryImport> {
  return fetchEventorEntryImport({ ...input, profile: "testeventor-se" }, options);
}
