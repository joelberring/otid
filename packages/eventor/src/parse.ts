import {
  attribute, dateTime, displayText, externalId, fail, many, optionalDisplayText, optionalExternalId, parseDocument, record, textOf,
  type XmlRecord
} from "./xml";

/**
 * Eventors API-format → O-Tids projektion vid adaptergränsen (AGENTS.md: externa format
 * mappas här). Bara fälten som tävlingen behöver läses: namn, klubb, klass, bricka och
 * Eventors id:n som extern identitet. Födelsedatum, adresser och avgifter lämnas.
 */

export interface EventorOrganisation {
  readonly id: string;
  readonly name: string;
}

/** `eventForm` i Eventor: IndSingleDay, IndMultiDay, RelaySingleDay, RelayMultiDay, PatrolSingleDay … */
export type EventorEventForm = "INDIVIDUAL" | "RELAY" | "OTHER";

export interface EventorEvent {
  readonly id: string;
  readonly name: string;
  readonly date: string;
  readonly clock?: string;
  readonly form: EventorEventForm;
  readonly organiserIds: readonly string[];
  readonly races: readonly { readonly id: string; readonly name: string; readonly date: string; readonly clock?: string }[];
}

export interface EventorClass {
  readonly id: string;
  readonly name: string;
  /** Inställd klass i Eventor (`EventClassStatus` annat än normal). */
  readonly cancelled: boolean;
}

export interface EventorClub {
  readonly id?: string;
  readonly name: string;
}

export interface EventorEntry {
  readonly id: string;
  readonly classId: string;
  readonly personId?: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly club?: EventorClub;
  /** SPORTident-brickans nummer; saknas om löparen inte angett bricka. */
  readonly cardNumber?: string;
}

export interface EventorTeamRunner {
  readonly leg: number;
  readonly personId?: string;
  /** Saknas när laget ännu inte satt någon löpare på sträckan. */
  readonly givenName?: string;
  readonly familyName?: string;
  readonly club?: EventorClub;
  readonly cardNumber?: string;
}

export interface EventorTeamEntry {
  readonly id: string;
  readonly classId: string;
  readonly name: string;
  readonly club?: EventorClub;
  readonly runners: readonly EventorTeamRunner[];
}

export interface EventorEntryList {
  readonly entries: readonly EventorEntry[];
  readonly teams: readonly EventorTeamEntry[];
}

const MAX_EVENTS = 2_000;
const MAX_CLASSES = 500;
const MAX_ENTRIES = 10_000;
const MAX_LEGS = 20;

export function parseEventorOrganisation(xml: string): EventorOrganisation {
  const root = parseDocument(xml, "Organisation");
  return { id: externalId(root.OrganisationId), name: displayText(root.Name) };
}

function eventForm(value: string | undefined): EventorEventForm {
  if (!value || value.startsWith("Ind")) return "INDIVIDUAL";
  if (value.startsWith("Relay")) return "RELAY";
  return "OTHER";
}

function organiserIds(event: XmlRecord): string[] {
  const ids = new Set<string>();
  for (const rawOrganiser of many(event.Organiser)) {
    const organiser = record(rawOrganiser);
    if (!organiser) continue;
    for (const id of many(organiser.OrganisationId)) ids.add(externalId(id));
    for (const organisation of many(organiser.Organisation)) {
      const id = optionalExternalId(record(organisation)?.OrganisationId);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

function readEvent(raw: unknown): EventorEvent {
  const event = record(raw);
  if (!event) fail("INVALID_XML");
  const id = externalId(event.EventId);
  const start = dateTime(event.StartDate);
  const races = many(event.EventRace).map((rawRace) => {
    const race = record(rawRace);
    if (!race) fail("INVALID_XML");
    const raceDate = dateTime(race.RaceDate);
    return { id: externalId(race.EventRaceId), name: displayText(race.Name), date: raceDate.date,
      ...(raceDate.clock ? { clock: raceDate.clock } : {}) };
  });
  return { id, name: displayText(event.Name), date: start.date, ...(start.clock ? { clock: start.clock } : {}),
    form: eventForm(attribute(event, "eventForm")), organiserIds: organiserIds(event), races };
}

export function parseEventorEvent(xml: string): EventorEvent {
  return readEvent(parseDocument(xml, "Event"));
}

export function parseEventorEventList(xml: string): readonly EventorEvent[] {
  const root = parseDocument(xml, "EventList");
  const events = many(root.Event);
  if (events.length > MAX_EVENTS) fail("RESPONSE_TOO_LARGE");
  return events.map(readEvent);
}

export function parseEventorClasses(xml: string): readonly EventorClass[] {
  const root = parseDocument(xml, "EventClassList");
  const rawClasses = many(root.EventClass);
  if (rawClasses.length > MAX_CLASSES) fail("RESPONSE_TOO_LARGE");
  const seen = new Set<string>();
  return rawClasses.map((rawClass) => {
    const eventClass = record(rawClass);
    if (!eventClass) fail("INVALID_XML");
    const id = externalId(eventClass.EventClassId);
    if (seen.has(id)) fail("INVALID_XML");
    seen.add(id);
    const status = attribute(eventClass.EventClassStatus, "value") ?? textOf(eventClass.EventClassStatus) ?? "normal";
    return { id, name: displayText(eventClass.Name), cancelled: status.toLowerCase() !== "normal" };
  });
}

/** Förnamn kan vara flera `<Given sequence="n">`; de sätts ihop i ordning. */
function personName(person: XmlRecord | undefined): { givenName: string; familyName: string } | undefined {
  const name = record(person?.PersonName);
  if (!name) return undefined;
  const given = many(name.Given).map((value, index) => ({ text: displayText(value),
    order: Number(attribute(value, "sequence") ?? index + 1) })).sort((left, right) => left.order - right.order);
  const familyName = displayText(name.Family);
  const givenName = given.map((value) => value.text).join(" ");
  if (!givenName || givenName.length > 160) fail("INVALID_XML");
  return { givenName, familyName };
}

function club(holder: XmlRecord): EventorClub | undefined {
  const organisation = record(many(holder.Organisation)[0]);
  const name = optionalDisplayText(organisation?.Name);
  if (!name) return undefined;
  const id = optionalExternalId(organisation?.OrganisationId) ?? optionalExternalId(holder.OrganisationId);
  return id ? { id, name } : { name };
}

/** SPORTident-brickan; andra stämpelsystem (t.ex. Emit) och bricknummer som inte är siffror hoppas över. */
function siCard(holder: XmlRecord): string | undefined {
  for (const rawCard of many(holder.CCard)) {
    const card = record(rawCard);
    const system = attribute(card?.PunchingUnitType, "value") ?? "SI";
    const number = textOf(card?.CCardId);
    if (system.toUpperCase() === "SI" && number && /^[1-9]\d{0,8}$/.test(number)) return number;
  }
  return undefined;
}

function entryClassId(entry: XmlRecord): string {
  const classes = many(entry.EntryClass).map(record);
  const first = classes.find((value) => attribute(value, "sequence") === "1" || attribute(value, "sequence") === undefined) ?? classes[0];
  return externalId(first?.EventClassId);
}

function individual(entry: XmlRecord, id: string): EventorEntry {
  const competitor = record(many(entry.Competitor)[0]);
  if (!competitor) fail("INVALID_XML");
  const person = record(many(competitor.Person)[0]);
  const name = personName(person);
  if (!name) fail("INVALID_XML");
  const personId = optionalExternalId(person?.PersonId) ?? optionalExternalId(competitor.PersonId);
  const organisation = club(competitor);
  const cardNumber = siCard(competitor);
  return { id, classId: entryClassId(entry), ...(personId ? { personId } : {}), ...name,
    ...(organisation ? { club: organisation } : {}), ...(cardNumber ? { cardNumber } : {}) };
}

function team(entry: XmlRecord, id: string): EventorTeamEntry {
  const organisation = club(entry);
  const runners = many(entry.TeamCompetitor).map((rawRunner, index) => {
    const runner = record(rawRunner) ?? {};
    const legText = textOf(runner.TeamSequence) ?? String(index + 1);
    const leg = Number(legText);
    if (!/^[1-9]\d?$/.test(legText) || leg > MAX_LEGS) fail("INVALID_XML");
    const person = record(many(runner.Person)[0]);
    const name = personName(person);
    const personId = optionalExternalId(person?.PersonId) ?? optionalExternalId(runner.PersonId);
    const runnerClub = club(runner);
    const cardNumber = siCard(runner);
    return { leg, ...(personId ? { personId } : {}), ...(name ?? {}), ...(runnerClub ? { club: runnerClub } : {}),
      ...(cardNumber ? { cardNumber } : {}) };
  }).sort((left, right) => left.leg - right.leg);
  if (new Set(runners.map((runner) => runner.leg)).size !== runners.length) fail("INVALID_XML");
  return { id, classId: entryClassId(entry), name: displayText(entry.TeamName), ...(organisation ? { club: organisation } : {}), runners };
}

/** Anmälningarna: individuella (`Competitor`) och lag (`TeamName` + `TeamCompetitor`). */
export function parseEventorEntries(xml: string): EventorEntryList {
  const root = parseDocument(xml, "EntryList");
  const rawEntries = many(root.Entry);
  if (rawEntries.length > MAX_ENTRIES) fail("RESPONSE_TOO_LARGE");
  const seen = new Set<string>();
  const entries: EventorEntry[] = [];
  const teams: EventorTeamEntry[] = [];
  for (const rawEntry of rawEntries) {
    const entry = record(rawEntry);
    if (!entry) fail("INVALID_XML");
    const id = externalId(entry.EntryId);
    if (seen.has(id)) fail("INVALID_XML");
    seen.add(id);
    if (entry.TeamName !== undefined || entry.TeamCompetitor !== undefined) teams.push(team(entry, id));
    else entries.push(individual(entry, id));
  }
  return { entries, teams };
}
