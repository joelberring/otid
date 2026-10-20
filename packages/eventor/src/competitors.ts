import { attribute, fail, many, optionalDisplayText, record, textOf, type XmlRecord } from "./xml";
import { streamElements, textChunks } from "./stream";

/**
 * Löpardatabasen (PLAN.md steg 29): Eventors `GET /api/export/cachedcompetitors` (IOF 3.0 `CompetitorList`) och
 * `GET /api/organisations` (Eventors äldre format, `OrganisationList`) → O-Tids projektion vid adaptergränsen.
 *
 * Dataminimering: av löparen läses bara Eventors person-id, för- och efternamn, födelseår (inte hela datumet), kön,
 * klubb och SPORTident-brickor. Nationalitet, födelsedag, adresser och andra stämpelsystem lämnas.
 */
export type EventorSex = "F" | "M";

export interface EventorCompetitorClub {
  readonly id?: string;
  readonly name: string;
  readonly shortName?: string;
}

export interface EventorCompetitor {
  readonly personId?: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly birthYear?: number;
  readonly sex?: EventorSex;
  readonly club?: EventorCompetitorClub;
  /** SPORTident-brickor (siffror, utan dubbletter, i Eventors ordning). Andra stämpelsystem hoppas över. */
  readonly cardNumbers: readonly string[];
}

export interface EventorCompetitorList {
  readonly competitors: readonly EventorCompetitor[];
  /** Löpare utan för- eller efternamn går inte att föreslå och hoppas över. */
  readonly skipped: number;
}

/**
 * Organisationens typ. Eventors äldre `OrganisationTypeId` är inte provad mot riktiga Eventor: 1 = förbund, 2 =
 * distrikt, 3 = klubb är vår tolkning; okända värden blir OTHER och alla typer behålls (med typen som etikett).
 */
export type EventorOrganisationType = "FEDERATION" | "DISTRICT" | "CLUB" | "OTHER";

export interface EventorOrganisationSummary {
  readonly id: string;
  readonly name: string;
  readonly shortName?: string;
  readonly type: EventorOrganisationType;
}

export const MAX_COMPETITORS = 400_000;
export const MAX_ORGANISATIONS = 50_000;
const CARD = /^[1-9]\d{0,8}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function optionalId(value: unknown): string | undefined {
  const text = textOf(value);
  if (text === undefined) return undefined;
  if (!ID.test(text)) fail("INVALID_XML");
  return text;
}

/** IOF 3.0 `<Id type="…">`: ett enda id gäller; av flera väljs Eventors (typ som innehåller "eventor") annars det första. */
function iofId(holder: XmlRecord | undefined): string | undefined {
  const ids = many(holder?.Id);
  if (ids.length === 0) return undefined;
  const chosen = ids.length === 1 ? ids[0] : ids.find((id) => /eventor/i.test(attribute(id, "type") ?? "")) ?? ids[0];
  return optionalId(chosen);
}

/** Förnamn (flera `<Given>` sätts ihop) och efternamn; tomma namn (Eventor skickar ibland `<Name></Name>`) ger undefined. */
function name(person: XmlRecord): { givenName: string; familyName: string } | undefined {
  const personName = record(many(person.Name)[0]);
  if (!personName) return undefined;
  const given = many(personName.Given).map((value) => optionalDisplayText(value)).filter((value): value is string => !!value).join(" ");
  const family = optionalDisplayText(personName.Family);
  if (!given || !family) return undefined;
  if (given.length > 160) fail("INVALID_XML");
  return { givenName: given, familyName: family };
}

function birthYear(person: XmlRecord): number | undefined {
  const text = textOf(person.BirthDate);
  if (text === undefined) return undefined;
  const match = /^(\d{4})-\d{2}-\d{2}/.exec(text);
  if (!match) fail("INVALID_XML");
  const year = Number(match[1]);
  return year >= 1900 && year <= 2100 ? year : undefined;
}

function sex(person: XmlRecord): EventorSex | undefined {
  const value = attribute(person, "sex")?.toUpperCase();
  return value === "F" || value === "M" ? value : undefined;
}

function competitorClub(competitor: XmlRecord): EventorCompetitorClub | undefined {
  const organisation = record(many(competitor.Organisation)[0]);
  if (!organisation) return undefined;
  const clubName = optionalDisplayText(organisation.Name);
  if (!clubName) return undefined;
  const id = iofId(organisation);
  const shortName = optionalDisplayText(organisation.ShortName);
  return { ...(id ? { id } : {}), name: clubName, ...(shortName ? { shortName } : {}) };
}

/** `<ControlCard punchingSystem="SI">`; utan system räknas brickan som SI. Andra system och icke-siffror hoppas över. */
function cards(competitor: XmlRecord): string[] {
  const numbers: string[] = [];
  for (const card of many(competitor.ControlCard)) {
    const system = attribute(card, "punchingSystem") ?? "SI";
    const number = textOf(card);
    if (system.toUpperCase() === "SI" && number && CARD.test(number) && !numbers.includes(number)) numbers.push(number);
  }
  return numbers;
}

function readCompetitor(competitor: XmlRecord): EventorCompetitor | undefined {
  const person = record(many(competitor.Person)[0]);
  if (!person) return undefined;
  const names = name(person);
  if (!names) return undefined;
  const personId = iofId(person);
  const year = birthYear(person);
  const personSex = sex(person);
  const club = competitorClub(competitor);
  return { ...(personId ? { personId } : {}), ...names, ...(year ? { birthYear: year } : {}), ...(personSex ? { sex: personSex } : {}),
    ...(club ? { club } : {}), cardNumbers: cards(competitor) };
}

/** Läser `CompetitorList` som ström (hela landet kan vara tiotals MB). */
export async function parseEventorCompetitorStream(chunks: AsyncIterable<string>): Promise<EventorCompetitorList> {
  const competitors: EventorCompetitor[] = [];
  let skipped = 0;
  await streamElements(chunks, "CompetitorList", "Competitor", { maxElements: MAX_COMPETITORS }, (element) => {
    const competitor = readCompetitor(element);
    if (competitor) competitors.push(competitor); else skipped += 1;
  });
  return { competitors, skipped };
}

export function parseEventorCompetitorList(xml: string): Promise<EventorCompetitorList> {
  if (typeof xml !== "string") fail("INVALID_INPUT");
  return parseEventorCompetitorStream(textChunks(xml));
}

function legacyType(typeId: string | undefined, iofType: string | undefined): EventorOrganisationType {
  if (typeId !== undefined) return typeId === "1" ? "FEDERATION" : typeId === "2" ? "DISTRICT" : typeId === "3" ? "CLUB" : "OTHER";
  switch (iofType?.toLowerCase()) {
    case "club": return "CLUB";
    case "nationalregion": case "iofregion": return "DISTRICT";
    case "nationalfederation": case "iof": return "FEDERATION";
    default: return "OTHER";
  }
}

/** En organisation i Eventors äldre format (`OrganisationId`, `OrganisationTypeId`) eller IOF 3.0 (`Id`, `type`). */
function readOrganisation(organisation: XmlRecord): EventorOrganisationSummary | undefined {
  const id = optionalId(organisation.OrganisationId) ?? iofId(organisation);
  const organisationName = optionalDisplayText(organisation.Name);
  if (!id || !organisationName) return undefined;
  const shortName = optionalDisplayText(organisation.ShortName);
  const typeId = textOf(organisation.OrganisationTypeId) ?? attribute(organisation.OrganisationTypeId, "value");
  return { id, name: organisationName, ...(shortName ? { shortName } : {}), type: legacyType(typeId, attribute(organisation, "type")) };
}

/** Alla organisationer (förbund, distrikt och klubbar). Utan id eller namn hoppas de över; ett id räknas en gång. */
export async function parseEventorOrganisationStream(chunks: AsyncIterable<string>): Promise<readonly EventorOrganisationSummary[]> {
  const organisations = new Map<string, EventorOrganisationSummary>();
  await streamElements(chunks, "OrganisationList", "Organisation", { maxElements: MAX_ORGANISATIONS }, (element) => {
    const organisation = readOrganisation(element);
    if (organisation && !organisations.has(organisation.id)) organisations.set(organisation.id, organisation);
  });
  return [...organisations.values()];
}

export function parseEventorOrganisations(xml: string): Promise<readonly EventorOrganisationSummary[]> {
  if (typeof xml !== "string") fail("INVALID_INPUT");
  return parseEventorOrganisationStream(textChunks(xml));
}

