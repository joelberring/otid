import { createHash } from "node:crypto";
import { EventorAdapterError } from "./errors";
import {
  parseEventorClasses, parseEventorEntries, parseEventorEvent, parseEventorEventList, parseEventorOrganisation,
  type EventorClass, type EventorEntryList, type EventorEvent, type EventorOrganisation
} from "./parse";
import { fail, MAX_XML_BYTES } from "./xml";

/** Eventor Sverige. Andra adresser används bara när driften uttryckligen anger en (t.ex. en testserver). */
export const EVENTOR_BASE_URL = "https://eventor.orientering.se";
const API_KEY = /^[\x21-\x7e]{16,128}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface EventorClientOptions {
  /** Klubbens API-nyckel. Skickas bara i headern `ApiKey`, aldrig i adressen eller loggar. */
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface EventorClassesAndEntries {
  readonly classes: readonly EventorClass[];
  readonly entries: EventorEntryList;
  /** SHA-256 av båda svaren; visar om källan ändrats mellan två läsningar. */
  readonly sourceHash: string;
}

/** Giltig nyckel att spara: 16–128 synliga ASCII-tecken (Eventors klubbnycklar är 32). */
export function isPlausibleEventorApiKey(value: string): boolean {
  return API_KEY.test(value);
}

/** Basadressen som driften angett: absolut http(s)-adress utan användaruppgifter, sökväg eller fråga. */
export function normalizeEventorBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { fail("INVALID_INPUT"); }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.search || url.hash ||
      (url.pathname !== "/" && url.pathname !== "")) fail("INVALID_INPUT");
  return url.origin;
}

function isXmlContentType(value: string | null): boolean {
  return !!value && /^(?:application|text)\/(?:[\w.+-]*\+)?xml(?:\s*;|\s*$)/i.test(value.trim());
}

async function readBody(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_XML_BYTES)) {
    void response.body?.cancel().catch(() => undefined);
    fail("RESPONSE_TOO_LARGE");
  }
  if (!response.body) fail("UPSTREAM_UNAVAILABLE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      if (signal.aborted) fail("TIMEOUT");
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_XML_BYTES) fail("RESPONSE_TOO_LARGE");
      chunks.push(next.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof EventorAdapterError) throw error;
    fail(signal.aborted ? "TIMEOUT" : "UPSTREAM_UNAVAILABLE");
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

/**
 * Läser Eventor med klubbens nyckel. Inga omdirigeringar, tidsgräns, storleksgräns och
 * bara XML-svar. Felen är koder utan innehåll från Eventor.
 */
export function eventorClient(options: EventorClientOptions) {
  if (typeof options.apiKey !== "string" || !isPlausibleEventorApiKey(options.apiKey)) fail("INVALID_INPUT");
  const origin = normalizeEventorBaseUrl(options.baseUrl ?? EVENTOR_BASE_URL);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;

  async function get(path: string): Promise<{ xml: string; sourceHash: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchImplementation(`${origin}${path}`, { method: "GET", redirect: "error", cache: "no-store",
          credentials: "omit", signal: controller.signal,
          headers: { ApiKey: options.apiKey, Accept: "application/xml, text/xml;q=0.9" } });
      } catch {
        fail(controller.signal.aborted ? "TIMEOUT" : "UPSTREAM_UNAVAILABLE");
      }
      if (response.status === 401 || response.status === 403) { void response.body?.cancel().catch(() => undefined); fail("REJECTED"); }
      if (response.status === 404) { void response.body?.cancel().catch(() => undefined); fail("NOT_FOUND"); }
      if (!response.ok || !isXmlContentType(response.headers.get("content-type"))) {
        void response.body?.cancel().catch(() => undefined);
        fail("UPSTREAM_UNAVAILABLE");
      }
      const bytes = await readBody(response, controller.signal);
      let xml: string;
      try { xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail("INVALID_XML"); }
      return { xml, sourceHash: createHash("sha256").update(bytes).digest("hex") };
    } finally {
      clearTimeout(timer);
    }
  }

  function id(value: string): string {
    if (!ID.test(value)) fail("INVALID_INPUT");
    return encodeURIComponent(value);
  }

  return {
    /** Klubben som nyckeln tillhör. Används för att testa anslutningen. */
    async organisation(): Promise<EventorOrganisation> {
      return parseEventorOrganisation((await get("/api/organisation/apiKey")).xml);
    },
    /** Tävlingar som klubben arrangerar mellan två datum. */
    async events(input: { organisationId: string; fromDate: string; toDate: string }): Promise<readonly EventorEvent[]> {
      if (!DATE.test(input.fromDate) || !DATE.test(input.toDate)) fail("INVALID_INPUT");
      const xml = (await get(`/api/events?organisationIds=${id(input.organisationId)}&fromDate=${input.fromDate}&toDate=${input.toDate}`)).xml;
      return parseEventorEventList(xml);
    },
    async event(eventId: string): Promise<EventorEvent> {
      const event = parseEventorEvent((await get(`/api/event/${id(eventId)}`)).xml);
      if (event.id !== eventId) fail("INVALID_XML");
      return event;
    },
    /** Klasser och anmälningar (med person, klubb och bricka) för en tävling. */
    async classesAndEntries(eventId: string): Promise<EventorClassesAndEntries> {
      const classes = await get(`/api/eventclasses?eventId=${id(eventId)}`);
      const entries = await get(`/api/entries?eventIds=${id(eventId)}&includePersonElement=true&includeOrganisationElement=true`);
      const parsedClasses = parseEventorClasses(classes.xml);
      const parsedEntries = parseEventorEntries(entries.xml);
      const classIds = new Set(parsedClasses.map((value) => value.id));
      if ([...parsedEntries.entries, ...parsedEntries.teams].some((entry) => !classIds.has(entry.classId))) fail("INVALID_XML");
      return { classes: parsedClasses, entries: parsedEntries,
        sourceHash: createHash("sha256").update(`${classes.sourceHash}:${entries.sourceHash}`).digest("hex") };
    }
  };
}

export type EventorClient = ReturnType<typeof eventorClient>;
