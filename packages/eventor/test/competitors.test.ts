import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  EventorAdapterError, eventorClient, parseEventorCompetitorList, parseEventorCompetitorStream, parseEventorOrganisations
} from "../src/index";

/**
 * PLAN.md steg 29: löpardatabasen. `competitors.xml` har samma struktur som Eventors riktiga svar (provat 2026-10-19 med
 * klubbens nyckel, värdena borttagna) men påhittade löpare.
 */
const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/eventor/${name}`, import.meta.url), "utf8");
const KEY = "0123456789abcdef0123456789abcdef";

async function code(action: () => Promise<unknown>): Promise<string | undefined> {
  try { await action(); } catch (error) { return error instanceof EventorAdapterError ? error.code : `OTHER ${String(error)}`; }
  return undefined;
}

const competitor = (inner: string) => `<Competitor><Person sex="M"><Id type="Eventor">1</Id><Name><Family>Ek</Family><Given>Åke</Given></Name>
  </Person>${inner}</Competitor>`;
const list = (body: string, prolog = "<?xml version=\"1.0\" encoding=\"utf-8\"?>") =>
  `${prolog}<CompetitorList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0">${body}</CompetitorList>`;

describe("löpardatabasen: CompetitorList → projektion", () => {
  it("läser löpare med id, namn, födelseår (inte datum), kön, klubb och SI-brickor", async () => {
    const { competitors, skipped } = await parseEventorCompetitorList(fixture("competitors.xml"));
    expect(competitors).toHaveLength(5);
    expect(skipped).toBe(1);
    expect(competitors[0]).toEqual({ personId: "610101", givenName: "Testa", familyName: "Testsson", birthYear: 1975, sex: "F",
      club: { id: "9321", name: "OK Skogsfalken", shortName: "Skogsfalken" }, cardNumbers: ["8100101"] });
    expect(JSON.stringify(competitors)).not.toContain("1975-05-17");
    expect(JSON.stringify(competitors)).not.toContain("SWE");
  });

  it("flera brickor, Emit-bricka hoppas över, löpare utan klubb och utan bricka", async () => {
    const { competitors } = await parseEventorCompetitorList(fixture("competitors.xml"));
    expect(competitors.find(row => row.personId === "610102")!.cardNumbers).toEqual(["8100102", "8100103"]);
    expect(competitors.find(row => row.personId === "610103")).toEqual({ personId: "610103", givenName: "Udda", familyName: "Klubblös",
      birthYear: 2001, sex: "M", cardNumbers: ["8100104"] });
    expect(competitors.find(row => row.personId === "610105")!.cardNumbers).toEqual([]);
    expect(competitors.find(row => row.personId === "610106")).toMatchObject({ givenName: "Åsa", familyName: "Öberg-Ärling",
      club: { id: "9400", name: "Järfälla OK" } });
  });

  it("tål BOM, saknat prolog, tom lista, namnrymd och godtyckliga bitgränser", async () => {
    const xml = fixture("competitors.xml");
    expect((await parseEventorCompetitorList(`\ufeff${xml}`)).competitors).toHaveLength(5);
    expect((await parseEventorCompetitorList(list(competitor(""), ""))).competitors).toHaveLength(1);
    expect(await parseEventorCompetitorList("<CompetitorList/>")).toEqual({ competitors: [], skipped: 0 });
    expect(await parseEventorCompetitorList(list(""))).toEqual({ competitors: [], skipped: 0 });
    for (const size of [1, 7, 64, 333, 4096]) {
      async function* chunks() { for (let offset = 0; offset < xml.length; offset += size) yield xml.slice(offset, offset + size); }
      const parsed = await parseEventorCompetitorStream(chunks());
      expect(parsed.competitors.map(row => row.personId), `bitar om ${size}`).toEqual(["610101", "610102", "610103", "610105", "610106"]);
    }
  });

  it("brickor utan system räknas som SI; bokstäver, nollor och dubbletter hoppas över", async () => {
    const parsed = await parseEventorCompetitorList(list(competitor(
      "<ControlCard>8001234</ControlCard><ControlCard punchingSystem=\"si\">8001234</ControlCard><ControlCard>12AB</ControlCard><ControlCard>0123</ControlCard>")));
    expect(parsed.competitors[0]!.cardNumbers).toEqual(["8001234"]);
  });

  it("avvisar DTD, trasig XML, fel rot, text mellan löparna och avbrutet svar", async () => {
    expect(await code(() => parseEventorCompetitorList(`<!DOCTYPE x [<!ENTITY a "b">]>${list(competitor(""))}`))).toBe("INVALID_XML");
    expect(await code(() => parseEventorCompetitorList(list(competitor("<ControlCard>1</ControlCard").replace("</Competitor>", ""))))).toBe("INVALID_XML");
    expect(await code(() => parseEventorCompetitorList("<EntryList></EntryList>"))).toBe("INVALID_XML");
    expect(await code(() => parseEventorCompetitorList(list(`hej${competitor("")}`)))).toBe("INVALID_XML");
    expect(await code(() => parseEventorCompetitorList(list(competitor("")).replace("</CompetitorList>", "")))).toBe("INVALID_XML");
    expect(await code(() => parseEventorCompetitorList(list(competitor("<ControlCard>&secret;</ControlCard>"))))).toBe("INVALID_XML");
  });
});

describe("löpardatabasen: organisationer (Eventors äldre format)", () => {
  it("läser alla organisationer med typ som etikett; utan namn hoppas över", async () => {
    const organisations = await parseEventorOrganisations(fixture("organisations.xml"));
    expect(organisations.map(row => [row.id, row.name, row.shortName, row.type])).toEqual([
      ["1", "Svenska Orienteringsförbundet", "SOFT", "FEDERATION"],
      ["17", "Skogsby Orienteringsförbund", "Skogsby OF", "DISTRICT"],
      ["9321", "OK Skogsfalken", "Skogsfalken", "CLUB"],
      ["9400", "Järfälla OK", "Järfälla", "CLUB"],
      ["9500", "Ängsbacka SOK", "Ängsbacka", "CLUB"],
      ["9700", "Skogsby Friluftsgymnasium", undefined, "OTHER"]]);
  });

  it("läser också IOF 3.0-formen (Id och type) om Eventor svarar så", async () => {
    const xml = `<OrganisationList><Organisation type="Club"><Id>5</Id><Name>OK Ek</Name></Organisation>
      <Organisation type="NationalRegion"><Id>6</Id><Name>Distriktet</Name></Organisation></OrganisationList>`;
    expect((await parseEventorOrganisations(xml)).map(row => [row.id, row.type])).toEqual([["5", "CLUB"], ["6", "DISTRICT"]]);
  });
});

function response(body: string) {
  return new Response(body, { headers: { "content-type": "text/xml; charset=utf-8" } });
}

describe("eventorClient: löpardatabasen", () => {
  it("frågar efter klubbarnas löpare utan förvalda klasser, och hela landet utan klubbar", async () => {
    const urls: string[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(url);
      expect(init?.headers).toMatchObject({ ApiKey: KEY });
      return response(new URL(url).pathname === "/api/organisations" ? fixture("organisations.xml") : fixture("competitors.xml"));
    }) as unknown as typeof globalThis.fetch;
    const client = eventorClient({ apiKey: KEY, fetch });
    expect((await client.competitors({ organisationIds: ["9321", "9400"] })).competitors).toHaveLength(5);
    expect((await client.competitors({ wholeCountry: true })).competitors).toHaveLength(5);
    expect(await client.organisations()).toHaveLength(6);
    expect(urls).toEqual([
      "https://eventor.orientering.se/api/export/cachedcompetitors?organisationIds=9321,9400&includePreselectedClasses=false",
      "https://eventor.orientering.se/api/export/cachedcompetitors?includePreselectedClasses=false",
      "https://eventor.orientering.se/api/organisations"]);
    expect(await code(() => client.competitors({ organisationIds: [] }))).toBe("INVALID_INPUT");
    expect(await code(() => client.competitors({ organisationIds: ["../x"] }))).toBe("INVALID_INPUT");
  });

  it("läser svaret som ström och avbryter vid storleksgränsen", async () => {
    const head = "<CompetitorList>";
    const one = competitor("<ControlCard>8001234</ControlCard>");
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        // 33 MB löpare (med blanktecken emellan) utan slut: klubbsvarets gräns är 32 MB.
        if (sent > 33 * 1024 * 1024) { controller.close(); return; }
        const chunk = new TextEncoder().encode(sent === 0 ? head : `${one}${" ".repeat(500_000)}`);
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      }
    });
    const fetch = (async () => new Response(body, { headers: { "content-type": "text/xml" } })) as unknown as typeof globalThis.fetch;
    expect(await code(() => eventorClient({ apiKey: KEY, fetch }).competitors({ organisationIds: ["9321"] }))).toBe("RESPONSE_TOO_LARGE");
    const declared = (async () => new Response("x", { headers: { "content-type": "text/xml", "content-length": String(300 * 1024 * 1024) } })) as
      unknown as typeof globalThis.fetch;
    expect(await code(() => eventorClient({ apiKey: KEY, fetch: declared }).competitors({ wholeCountry: true }))).toBe("RESPONSE_TOO_LARGE");
  });

  it("ger fel nyckel och otillgänglig Eventor som koder", async () => {
    const client = (status: number) => eventorClient({ apiKey: KEY, fetch: (async () => new Response("", { status })) as unknown as typeof fetch });
    expect(await code(() => client(401).competitors({ wholeCountry: true }))).toBe("REJECTED");
    expect(await code(() => client(503).organisations())).toBe("UPSTREAM_UNAVAILABLE");
  });
});
