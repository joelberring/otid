import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  EventorAdapterError, eventorClient, normalizeEventorBaseUrl, parseEventorClasses, parseEventorEntries, parseEventorEvent,
  parseEventorEventList, parseEventorOrganisation
} from "../src/index";

const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/eventor/${name}`, import.meta.url), "utf8");
const KEY = "0123456789abcdef0123456789abcdef";

function code(action: () => unknown): string | undefined {
  try { action(); } catch (error) { return error instanceof EventorAdapterError ? error.code : "OTHER"; }
  return undefined;
}

async function asyncCode(action: () => Promise<unknown>): Promise<string | undefined> {
  try { await action(); } catch (error) { return error instanceof EventorAdapterError ? error.code : "OTHER"; }
  return undefined;
}

describe("Eventors svar → projektion", () => {
  it("läser klubben som nyckeln tillhör", () => {
    expect(parseEventorOrganisation(fixture("organisation.xml"))).toEqual({ id: "9321", name: "OK Skogsfalken" });
  });

  it("läser arrangörens tävlingar med form, datum, klockslag och arrangör", () => {
    const events = parseEventorEventList(fixture("events.xml"));
    expect(events.map(event => [event.id, event.name, event.date, event.clock, event.form])).toEqual([
      ["47110", "Höstsprinten i Skogsby", "2026-10-18", "10:00:00", "INDIVIDUAL"],
      ["47120", "Skogsfalkens klubbstafett", "2026-11-08", "11:00:00", "RELAY"]
    ]);
    expect(events[0]!.organiserIds).toEqual(["9321"]);
    expect(events[0]!.races).toEqual([{ id: "51001", name: "Höstsprinten i Skogsby", date: "2026-10-18", clock: "10:00:00" }]);
    expect(parseEventorEvent(fixture("event.xml")).id).toBe("47110");
    expect(parseEventorEventList("<EventList/>")).toEqual([]);
  });

  it("läser klasser med å ä ö och inställda klasser", () => {
    expect(parseEventorClasses(fixture("classes.xml")).map(row => row.name)).toEqual(["H21", "D21", "H35", "D35"]);
    expect(parseEventorClasses(fixture("relay-classes.xml"))).toEqual([{ id: "91001", name: "Öppen stafett", cancelled: false }]);
    const cancelled = "<EventClassList><EventClass><EventClassId>1</EventClassId><Name>Öppen 1</Name><EventClassStatus value=\"invalidated\"/></EventClass></EventClassList>";
    expect(parseEventorClasses(cancelled)[0]!.cancelled).toBe(true);
  });

  it("läser individuella anmälningar: namn med å ä ö, flera förnamn, klubb, bricka och saknad bricka", () => {
    const { entries, teams } = parseEventorEntries(fixture("entries-1.xml"));
    expect(teams).toEqual([]);
    expect(entries).toHaveLength(6);
    expect(entries[0]).toEqual({ id: "800001", classId: "90002", personId: "610001", givenName: "Anna", familyName: "Åkesson",
      club: { id: "9321", name: "OK Skogsfalken" }, cardNumber: "2101001" });
    expect(entries.find(entry => entry.id === "800004")).not.toHaveProperty("cardNumber");
    expect(entries.find(entry => entry.id === "800006")).toMatchObject({ givenName: "Fredrik Johan", familyName: "Nyström" });
    expect(entries.find(entry => entry.id === "800002")).toMatchObject({ familyName: "Öberg", club: { name: "Järfälla OK" } });
  });

  it("läser stafettlag med sträcklöpare, bricka och sträcka utan löpare", () => {
    const { entries, teams } = parseEventorEntries(fixture("relay-entries.xml"));
    expect(entries).toEqual([]);
    expect(teams.map(team => [team.id, team.name, team.club?.name, team.runners.length])).toEqual([
      ["820001", "OK Skogsfalken 1", "OK Skogsfalken", 3], ["820002", "Järfälla OK 1", "Järfälla OK", 3]]);
    expect(teams[0]!.runners[2]).toEqual({ leg: 3, personId: "610007", givenName: "Gustav", familyName: "Ek", cardNumber: "2101007" });
    expect(teams[1]!.runners[1]).toEqual({ leg: 2, personId: "610005", givenName: "Eva", familyName: "Ström" });
    expect(teams[1]!.runners[2]).toEqual({ leg: 3 });
  });

  it("hoppar över Emit-brickor och bricknummer som inte är siffror", () => {
    const xml = (card: string) => `<EntryList><Entry><EntryId>1</EntryId><Competitor><Person><PersonName><Family>Ås</Family>
      <Given>Åke</Given></PersonName></Person>${card}</Competitor><EntryClass><EventClassId>9</EventClassId></EntryClass></Entry></EntryList>`;
    expect(parseEventorEntries(xml("<CCard><CCardId>123456</CCardId><PunchingUnitType value=\"Emit\"/></CCard>")).entries[0]).not.toHaveProperty("cardNumber");
    expect(parseEventorEntries(xml("<CCard><CCardId>12AB</CCardId></CCard>")).entries[0]).not.toHaveProperty("cardNumber");
    expect(parseEventorEntries(xml("<CCard><CCardId>8001234</CCardId></CCard>")).entries[0]!.cardNumber).toBe("8001234");
  });

  it("avvisar DTD, okända entiteter, fel rot, dubbla id:n och anmälan utan namn", () => {
    expect(code(() => parseEventorOrganisation("<!DOCTYPE x [<!ENTITY a \"b\">]><Organisation/>"))).toBe("INVALID_XML");
    expect(code(() => parseEventorOrganisation("<Organisation><OrganisationId>&secret;</OrganisationId><Name>Ok</Name></Organisation>"))).toBe("INVALID_XML");
    expect(code(() => parseEventorClasses("<EntryList/>"))).toBe("INVALID_XML");
    const twice = "<EventClassList><EventClass><EventClassId>1</EventClassId><Name>H21</Name></EventClass><EventClass><EventClassId>1</EventClassId><Name>D21</Name></EventClass></EventClassList>";
    expect(code(() => parseEventorClasses(twice))).toBe("INVALID_XML");
    expect(code(() => parseEventorEntries("<EntryList><Entry><EntryId>1</EntryId><Competitor/><EntryClass><EventClassId>9</EventClassId></EntryClass></Entry></EntryList>")))
      .toBe("INVALID_XML");
  });
});

function response(body: string, init: { status?: number; type?: string } = {}) {
  return new Response(body, { status: init.status ?? 200, headers: { "content-type": init.type ?? "text/xml; charset=utf-8" } });
}

describe("eventorClient", () => {
  it("skickar nyckeln bara i headern ApiKey och använder Eventors adresser", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      const path = new URL(url).pathname;
      if (path === "/api/organisation/apiKey") return response(fixture("organisation.xml"));
      if (path === "/api/events") return response(fixture("events.xml"));
      if (path === "/api/eventclasses") return response(fixture("classes.xml"));
      return response(fixture("entries-1.xml"));
    }) as unknown as typeof globalThis.fetch;
    const client = eventorClient({ apiKey: KEY, fetch });
    expect((await client.organisation()).name).toBe("OK Skogsfalken");
    expect(await client.events({ organisationId: "9321", fromDate: "2026-10-01", toDate: "2027-10-01" })).toHaveLength(2);
    const source = await client.classesAndEntries("47110");
    expect(source.classes).toHaveLength(4);
    expect(source.entries.entries).toHaveLength(6);
    expect(source.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(calls.map(call => call.url)).toEqual([
      "https://eventor.orientering.se/api/organisation/apiKey",
      "https://eventor.orientering.se/api/events?organisationIds=9321&fromDate=2026-10-01&toDate=2027-10-01",
      "https://eventor.orientering.se/api/eventclasses?eventId=47110",
      "https://eventor.orientering.se/api/entries?eventIds=47110&includePersonElement=true&includeOrganisationElement=true"]);
    for (const call of calls) {
      expect(call.url).not.toContain(KEY);
      expect(call.init.headers).toMatchObject({ ApiKey: KEY });
      expect(call.init.redirect).toBe("error");
    }
  });

  it("ger koder för fel nyckel, saknad tävling, serverfel, HTML och anmälan i okänd klass", async () => {
    const client = (reply: () => Response) => eventorClient({ apiKey: KEY, fetch: (async () => reply()) as unknown as typeof fetch });
    expect(await asyncCode(() => client(() => response("", { status: 401 })).organisation())).toBe("REJECTED");
    expect(await asyncCode(() => client(() => response("", { status: 404 })).event("1"))).toBe("NOT_FOUND");
    expect(await asyncCode(() => client(() => response("x", { status: 500 })).organisation())).toBe("UPSTREAM_UNAVAILABLE");
    expect(await asyncCode(() => client(() => response("<html/>", { type: "text/html" })).organisation())).toBe("UPSTREAM_UNAVAILABLE");
    expect(await asyncCode(() => client(() => { throw new Error("network"); }).organisation())).toBe("UPSTREAM_UNAVAILABLE");
    const mismatched = eventorClient({ apiKey: KEY, fetch: (async (url: string) => response(String(url).includes("eventclasses")
      ? fixture("relay-classes.xml") : fixture("entries-1.xml"))) as unknown as typeof fetch });
    expect(await asyncCode(() => mismatched.classesAndEntries("47110"))).toBe("INVALID_XML");
  });

  it("avvisar ogiltig nyckel och ogiltiga id:n innan något skickas", async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    expect(code(() => eventorClient({ apiKey: "kort", fetch }))).toBe("INVALID_INPUT");
    expect(await asyncCode(() => eventorClient({ apiKey: KEY, fetch }).event("../x"))).toBe("INVALID_INPUT");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("tar emot en uttrycklig basadress men bara som ren http(s)-adress", () => {
    expect(normalizeEventorBaseUrl("http://127.0.0.1:4319")).toBe("http://127.0.0.1:4319");
    expect(normalizeEventorBaseUrl("https://eventor-sweden-test.orientering.se/")).toBe("https://eventor-sweden-test.orientering.se");
    for (const invalid of ["ftp://x", "https://user:pw@x", "https://x/api", "https://x?y=1", "inte en adress"]) {
      expect(code(() => normalizeEventorBaseUrl(invalid))).toBe("INVALID_INPUT");
    }
  });
});
