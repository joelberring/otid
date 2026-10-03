import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  EventorAdapterError,
  fetchEventorEntryImport,
  fetchEventorEvent,
  fetchTesteventorEntryImport,
  fetchTesteventorEvent,
  parseEventorEntryImport,
  parseEventorEvent
} from "../src/index";

const eventXml = `<?xml version="1.0" encoding="UTF-8"?>
<Event xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="Event.xsd">
  <EventId>event alpha</EventId>
  <Name>  Testevent  </Name>
  <StartDate><Date>2026-09-05</Date><Clock>08:30:00</Clock></StartDate>
  <Ignored><Contact><Name>Private metadata</Name></Contact></Ignored>
  <EventRace><EventRaceId>race/1</EventRaceId><EventId>event alpha</EventId><Name>  Lång  </Name><RaceDate><Date>2026-09-05</Date></RaceDate><WRSInfo>ignored</WRSInfo></EventRace>
</Event>`;

function errorCode(action: () => unknown, code: string): void {
  expect(action).toThrow(EventorAdapterError);
  try {
    action();
  } catch (error) {
    expect((error as EventorAdapterError).code).toBe(code);
  }
}

describe("parseEventorEvent", () => {
  it("projects only the selected Event and direct EventRace metadata", () => {
    expect(parseEventorEvent(eventXml)).toEqual({
      eventId: "event alpha",
      eventName: "Testevent",
      startDate: "2026-09-05",
      startClock: "08:30:00",
      races: [{ eventRaceId: "race/1", raceName: "Lång", raceDate: "2026-09-05" }]
    });
  });

  it("permits zero direct races for later application-level selection handling", () => {
    expect(parseEventorEvent("<Event><EventId>e</EventId><Name>Tv</Name><StartDate><Date>2026-01-01</Date></StartDate></Event>").races).toEqual([]);
  });

  it("accepts only supported selected-field attributes and safely decodes standard XML references", () => {
    const xml = `<Event><EventId>event&amp;one</EventId><Name languageId="sv">Tv &amp; två</Name><StartDate><Date dateFormat="YYYY-MM-DD">0001-01-01</Date><Clock clockFormat="HH:MM:SS">08:30:00</Clock></StartDate><EventRace><EventRaceId>r</EventRaceId><EventId>event&amp;one</EventId><Name languageId="sv">Rä</Name><RaceDate><Date dateFormat="YYYY-MM-DD">0099-12-31</Date></RaceDate></EventRace></Event>`;
    expect(parseEventorEvent(xml)).toMatchObject({ eventId: "event&one", eventName: "Tv & två", startDate: "0001-01-01", startClock: "08:30:00" });
    for (const invalid of [
      xml.replace('dateFormat="YYYY-MM-DD"', 'dateFormat="YYYYMMDD"'),
      xml.replace('clockFormat="HH:MM:SS"', 'clockFormat="HH:MM"'),
      xml.replace("event&amp;one", "event&unknown;"),
      xml.replace("event&amp;one", "event&#0;")
    ]) errorCode(() => parseEventorEvent(invalid), "INVALID_XML");
  });

  it("decodes each XML reference once while preserving CDATA and comments literally", () => {
    const xml = "<Event><!-- & and </x> are comment text --><EventId>event&amp;#65;</EventId><Name><![CDATA[&amp;]]></Name><StartDate><Date>2026-01-01</Date></StartDate></Event>";
    expect(parseEventorEvent(xml)).toMatchObject({ eventId: "event&#65;", eventName: "&amp;" });
  });

  it("fails closed for declarations, namespaces, duplicate fields, nested races and reference mismatch", () => {
    for (const xml of [
      "<!DOCTYPE Event><Event/>",
      "<x:Event><EventId>e</EventId></x:Event>",
      "<Event xmlns=\"urn:foreign\"><EventId>e</EventId><Name>Tv</Name><StartDate><Date>2026-01-01</Date></StartDate></Event>",
      "<Event><EventId>e</EventId><Name>Tv</Name><StartDate><Date>2026-01-01</Date></StartDate></Event><Other/>",
      "<Event><EventId>e</EventId><EventId>f</EventId><Name>Tv</Name><StartDate><Date>2026-01-01</Date></StartDate></Event>",
      "<Event><EventId>e</EventId><Name>Tv</Name><StartDate><Date>2026-01-01</Date></StartDate><Other><EventRace/></Other></Event>",
      "<Event><EventId>e</EventId><Name>Tv</Name><StartDate><Date>2026-01-01</Date></StartDate><EventRace><EventRaceId>r</EventRaceId><EventId>other</EventId><Name>Tv</Name><RaceDate><Date>2026-01-01</Date></RaceDate></EventRace></Event>"
    ]) errorCode(() => parseEventorEvent(xml), "INVALID_XML");
  });

  it("enforces opaque IDs and exact supported calendar/clock fields", () => {
    for (const xml of [
      "<Event><EventId> e</EventId><Name>Tv</Name><StartDate><Date>2026-01-01</Date></StartDate></Event>",
      "<Event><EventId>.</EventId><Name>Tv</Name><StartDate><Date>2026-01-01</Date></StartDate></Event>",
      "<Event><EventId>e</EventId><Name>Tv</Name><StartDate><Date format=\"yyyyMMdd\">20260101</Date></StartDate></Event>",
      "<Event><EventId>e</EventId><Name>Tv</Name><StartDate><Date>0000-01-01</Date></StartDate></Event>",
      "<Event><EventId>e</EventId><Name>Tv</Name><StartDate><Date>2026-02-29</Date></StartDate></Event>",
      "<Event><EventId>e</EventId><Name>Tv</Name><StartDate><Date>2026-01-01</Date><Clock>08:30</Clock></StartDate></Event>"
    ]) errorCode(() => parseEventorEvent(xml), "INVALID_XML");
  });

  it("bounds hostile XML nesting and node complexity before parsing", () => {
    const base = "<Event><EventId>e</EventId><Name>Tv</Name><StartDate><Date>2026-01-01</Date></StartDate>";
    errorCode(() => parseEventorEvent(`${base}<Ignored>${"<x>".repeat(65)}${"</x>".repeat(65)}</Ignored></Event>`), "INVALID_XML");
    errorCode(() => parseEventorEvent(`${base}${"<x/>".repeat(10_001)}</Event>`), "INVALID_XML");
    expect(parseEventorEvent(`${base}<Ignored value="a > b"><!-- </x> --><![CDATA[</x> &amp;]]></Ignored></Event>`).eventId).toBe("e");
  });
});

const eventClassesXml = `<EventClassList>
  <EventClass sex="F"><EventClassId>class-1</EventClassId><Name>D21</Name><ClassShortName>D21</ClassShortName><EventClassStatus value="normal" /></EventClass>
  <EventClass sex="M"><EventClassId>class-2</EventClassId><Name>H21</Name><ClassShortName>H21</ClassShortName><EventClassStatus value="normal" /></EventClass>
</EventClassList>`;

const entriesXml = `<EntryList>
  <Entry><EntryId>entry-1</EntryId><Competitor><CompetitorId>competitor-1</CompetitorId><Person><PersonName><Family>Test</Family><Given sequence="1">Åsa</Given><Given sequence="2">Maria</Given></PersonName></Person><Organisation><OrganisationId>club-1</OrganisationId><Name>Test IF</Name><ShortName>TIF</ShortName></Organisation></Competitor><EntryClass><EventClassId>class-1</EventClassId></EntryClass></Entry>
  <Entry><EntryId>entry-2</EntryId><Competitor><CompetitorId>competitor-2</CompetitorId><Person><PersonName><Family>Prov</Family><Given>Bo</Given></PersonName></Person><OrganisationId>club-2</OrganisationId></Competitor><EntryClass><EventClassId>class-2</EventClassId></EntryClass></Entry>
</EntryList>`;

describe("parseEventorEntryImport", () => {
  it("projects only individual entries and class identifiers needed for explicit mapping", () => {
    expect(parseEventorEntryImport(eventClassesXml, entriesXml)).toEqual({
      classes: [{ externalId: "class-1", name: "D21" }, { externalId: "class-2", name: "H21" }],
      entries: [
        { externalId: "entry-1", externalClassId: "class-1", givenName: "Åsa Maria", familyName: "Test", organisationName: "Test IF" },
        { externalId: "entry-2", externalClassId: "class-2", givenName: "Bo", familyName: "Prov" }
      ]
    });
  });

  it("fails closed for a team, multiple class selectors, deleted classes, namespaces, duplicates and unknown source classes", () => {
    const team = entriesXml.replace("<Competitor><CompetitorId>competitor-1</CompetitorId><Person><PersonName><Family>Test</Family><Given sequence=\"1\">Åsa</Given><Given sequence=\"2\">Maria</Given></PersonName></Person><Organisation><OrganisationId>club-1</OrganisationId><Name>Test IF</Name><ShortName>TIF</ShortName></Organisation></Competitor>", "<TeamName>Lag</TeamName>");
    const invalid: readonly [string, string][] = [
      [eventClassesXml, team],
      [eventClassesXml, entriesXml.replace("</EntryClass></Entry>", "</EntryClass><EntryClass><EventClassId>class-2</EventClassId></EntryClass></Entry>")],
      [eventClassesXml.replace('value="normal"', 'value="deletedFee"'), entriesXml],
      [eventClassesXml.replace("<EventClassList>", '<EventClassList xmlns="urn:foreign">'), entriesXml],
      [eventClassesXml, entriesXml.replace("entry-2", "entry-1")],
      [eventClassesXml, entriesXml.replace("class-2", "class-unknown")]
    ];
    for (const [classes, entries] of invalid) errorCode(() => parseEventorEntryImport(classes, entries), "INVALID_XML");
  });
});

describe("fetchTesteventorEntryImport", () => {
  const apiKey = "12345678901234567890123456789012";

  it("reads only the two fixed Testeventor sources and hashes their complete bytes", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(eventClassesXml, {
        status: 200,
        headers: { "content-type": "application/xml; charset=utf-8" }
      }))
      .mockResolvedValueOnce(new Response(entriesXml, {
        status: 200,
        headers: { "content-type": "text/xml; charset=utf-8" }
      }));

    const result = await fetchTesteventorEntryImport({ eventId: "event alpha", apiKey }, { fetch });

    expect(result.projection.entries).toHaveLength(2);
    expect(result.eventClassesSourceHash).toBe(createHash("sha256").update(new TextEncoder().encode(eventClassesXml)).digest("hex"));
    expect(result.entriesSourceHash).toBe(createHash("sha256").update(new TextEncoder().encode(entriesXml)).digest("hex"));
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://eventor-sweden-test.orientering.se/api/eventclasses?eventId=event%20alpha",
      "https://eventor-sweden-test.orientering.se/api/entries?eventIds=event%20alpha"
    ]);
    for (const [, request] of fetch.mock.calls) {
      expect(request).toMatchObject({
        method: "GET",
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
        headers: { ApiKey: apiKey }
      });
    }
  });

  it("does not fetch invalid input and fails before a partial projection on an invalid source", async () => {
    const invalidInputFetch = vi.fn<typeof globalThis.fetch>();
    await expect(fetchTesteventorEntryImport({ eventId: "..", apiKey }, { fetch: invalidInputFetch })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(invalidInputFetch).not.toHaveBeenCalled();

    const invalidSourceFetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(eventClassesXml, { headers: { "content-type": "application/xml" } }))
      .mockResolvedValueOnce(new Response("not XML", { headers: { "content-type": "text/plain" } }));
    await expect(fetchTesteventorEntryImport({ eventId: "event alpha", apiKey }, { fetch: invalidSourceFetch })).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(invalidSourceFetch).toHaveBeenCalledTimes(2);
  });
});

describe("fetchTesteventorEvent", () => {
  const apiKey = "12345678901234567890123456789012";

  it("uses only the fixed Testeventor GET boundary and hashes the complete received bytes", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(eventXml, {
      status: 200,
      headers: { "content-type": "application/xml; charset=utf-8" }
    }));
    const result = await fetchTesteventorEvent({ eventId: "event alpha", apiKey }, { fetch });
    expect(result.projection.eventId).toBe("event alpha");
    expect(result.sourceHash).toBe(createHash("sha256").update(new TextEncoder().encode(eventXml)).digest("hex"));
    expect(fetch.mock.calls[0]?.[0]).toBe("https://eventor-sweden-test.orientering.se/api/event/event%20alpha");
    const request = fetch.mock.calls[0]?.[1];
    expect(request).toMatchObject({ method: "GET", redirect: "error", cache: "no-store", credentials: "omit", headers: { ApiKey: apiKey } });
  });

  it("rejects invalid inputs without invoking fetch", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(fetchTesteventorEvent({ eventId: "..", apiKey }, { fetch })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(fetchTesteventorEvent({ eventId: "event", apiKey: "short" }, { fetch })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(fetchTesteventorEvent({ eventId: "event", apiKey: `${apiKey}\n` }, { fetch })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(fetchTesteventorEvent({ eventId: "\ud800", apiKey }, { fetch })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not accept a non-XML, mismatched, or over-limit upstream response", async () => {
    await expect(fetchTesteventorEvent({ eventId: "event alpha", apiKey }, { fetch: async () => new Response("no", { headers: { "content-type": "text/plain" } }) })).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    await expect(fetchTesteventorEvent({ eventId: "event alpha", apiKey }, { fetch: async () => new Response(eventXml.replace("event alpha", "another"), { headers: { "content-type": "text/xml" } }) })).rejects.toMatchObject({ code: "INVALID_XML" });
    await expect(fetchTesteventorEvent({ eventId: "event alpha", apiKey }, { fetch: async () => new Response(eventXml, { headers: { "content-type": "application/xml", "content-length": "2097153" } }) })).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
    await expect(fetchTesteventorEvent({ eventId: "event alpha", apiKey }, { fetch: async () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-type": "application/xml" } }) })).rejects.toMatchObject({ code: "INVALID_XML" });
  });

  it("enforces the streaming limit even when content length is missing or lies", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); controller.close(); } });
    await expect(fetchTesteventorEvent({ eventId: "event alpha", apiKey }, { fetch: async () => new Response(stream, { headers: { "content-type": "application/xml", "content-length": "1" } }) })).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });

  it("times out a body read that never resolves", async () => {
    vi.useFakeTimers();
    try {
      const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => undefined) });
      const pending = fetchTesteventorEvent({ eventId: "event alpha", apiKey }, { fetch: async () => new Response(stream, { headers: { "content-type": "application/xml" } }) });
      const rejection = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
      await vi.advanceTimersByTimeAsync(10_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("production Eventor profile", () => {
  const apiKey = "12345678901234567890123456789012";

  it("uses the exact fixed production origin for both read-only sources", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(eventXml, { headers: { "content-type": "application/xml" } }))
      .mockResolvedValueOnce(new Response(eventClassesXml, { headers: { "content-type": "application/xml" } }))
      .mockResolvedValueOnce(new Response(entriesXml, { headers: { "content-type": "application/xml" } }));
    await fetchEventorEvent({ profile: "production-se", eventId: "event alpha", apiKey }, { fetch });
    await fetchEventorEntryImport({ profile: "production-se", eventId: "event alpha", apiKey }, { fetch });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://eventor.orientering.se/api/event/event%20alpha",
      "https://eventor.orientering.se/api/eventclasses?eventId=event%20alpha",
      "https://eventor.orientering.se/api/entries?eventIds=event%20alpha",
    ]);
    for (const [, request] of fetch.mock.calls) {
      expect(request).toMatchObject({ method: "GET", redirect: "error", cache: "no-store", credentials: "omit", headers: { ApiKey: apiKey } });
    }
  });

  it("rejects an unknown profile before opening any connection", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(fetchEventorEvent({ profile: "production" as never, eventId: "event", apiKey }, { fetch }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
