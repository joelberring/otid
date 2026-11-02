import { sql } from "drizzle-orm";
import type { DbExecutor } from "./snapshot";
import { bumpReadoutPackageVersion } from "./snapshot";
import { loadBackupCatalog, quoteIdentifier, type BackupColumn } from "./race-backup-catalog";
import { RACE_BACKUP_TABLES } from "./race-backup-tables";
import { sha256Hex } from "./serialization";

/**
 * ADR-0189 beslut 5: anonymisering av deltagare. Namn, klubb, bricka, födelseår och Eventors id tas bort ur tävlingen: ur
 * anmälan, journalerna (före/efter-JSON, begärandena och svaren), de publicerade listorna, fastställandets XML och de inlästa
 * filerna (IOF XML). Resultatet, sträcktiderna och avläsningarna står kvar; namnet blir "Anonym deltagare".
 *
 * Så går det till, i anroparens transaktion (tävlingen låst):
 * - En rad som pekar på deltagaren (en uuid-kolumn som entry_id, entity_id) "handlar om" deltagaren: i den ersätts alla
 *   personuppgifter efter fältens namn (givenName, familyName, organisationName, club, cardNumber, birthYear …) och alla värden
 *   som är lika med deltagarens namn, id eller brickor.
 * - I andra rader (t.ex. den publicerade startlistan och fastställandet, som har alla deltagare) ersätts bara de objekt som har
 *   deltagarens id (eller publika resultat-id) eller samma för- och efternamn.
 * - IOF XML: personens block (PersonEntry, PersonStart, PersonResult, TeamMember…) med samma namn eller Eventor-id får namnet
 *   "Anonym deltagare" och förlorar födelsedatum, id, bricka, klubb och kontaktuppgifter.
 * - Hela namnet (också ett tidigare namn) ersätts var det än står i texten.
 * - Kolumner som heter card_number är brickans identitet i avläsningen och brickjournalerna (främmande nycklar och oföränderliga
 *   råa avläsningar, AGENTS.md); de ändras inte. Råa avläsningar, deras tolkning och radiostämplingar ändras aldrig.
 * - GPS-rutten tas bort; utskriftsjobb (PDF) som nämner deltagaren tas bort; namnändringarnas journal tas bort (den består bara
 *   av namnen).
 */
export const ANONYMOUS_GIVEN_NAME = "Anonym";
export const ANONYMOUS_FAMILY_NAME = "deltagare";
const ANONYMOUS_NAME = `${ANONYMOUS_GIVEN_NAME} ${ANONYMOUS_FAMILY_NAME}`;

interface Person {
  readonly id: string;
  readonly publicResultId: string;
  /** Alla för- och efternamn deltagaren haft i tävlingen (gemener). */
  readonly given: Set<string>;
  readonly family: Set<string>;
  /** Hela namnet i de vanliga formerna (gemener), för att hitta det i text. */
  readonly phrases: Set<string>;
  /** Andra värden som pekar ut personen: Eventors id, externa id, brickor. */
  readonly identifiers: Set<string>;
}

/** Tabeller som inte innehåller deltagarens uppgifter, eller som aldrig får ändras (avläsningarna och brickans koppling). */
const SKIPPED = new Set(["event", "race", "control", "course", "course_version", "course_control", "course_variant", "course_variant_control",
  "class", "relay_leg", "raw_device_message", "device_ingest_outcome", "card_readout", "radio_punch", "card_assignment", "race_map",
  "race_map_source", "race_map_agreement", "race_route_choice", "participant_route", "course_setting", "course_setting_revision",
  "course_setting_change", "course_setting_grant", "course_setting_inspection", "course_setting_suggestion", "party_setting", "party_item",
  "party_item_price", "party_logo", "race_eventor_link", "race_radio_link", "race_radio_control", "race_station_correction",
  "start_checkin_device", "start_draw_slot", "start_draw_class", "entry", "team", "entry_identity_change_request"]);

type Rule = "given" | "family" | "null" | "delete" | "name";
/** Fält med personuppgifter i JSON och kolumner, efter namn (camelCase eller snake_case). */
function ruleFor(key: string): Rule | undefined {
  const k = key.replace(/_/g, "").toLowerCase();
  if (k === "givenname" || k === "firstname" || k === "given") return "given";
  if (k === "familyname" || k === "lastname" || k === "family") return "family";
  if (k === "organisationname" || k === "organizationname" || k === "club" || k === "clubname" || k === "organisation") return "null";
  if (k === "entryexternalid" || k === "externalid") return "null";
  if (/^(cardnumber|card|previouscardnumber|birthyear|birthdate|eventorpersonid|personeventorid|personid|eventororganisationid|organisationeventorid|email|phone)$/.test(k)) {
    return "delete";
  }
  if (k === "name" || k === "displayname" || k === "personname" || k === "fullname") return "name";
  return undefined;
}

const lower = (value: string) => value.trim().toLocaleLowerCase("sv");
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const xmlText = (value: string) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");

class Scrubber {
  readonly byId = new Map<string, Person>();
  private readonly phrase: RegExp | undefined;

  constructor(readonly persons: readonly Person[], private readonly otherEntryIds: ReadonlySet<string>) {
    for (const person of persons) { this.byId.set(person.id, person); this.byId.set(person.publicResultId, person); }
    const phrases = [...new Set(persons.flatMap(person => [...person.phrases]))].filter(value => value.length >= 5)
      .sort((a, b) => b.length - a.length);
    this.phrase = phrases.length > 0 ? new RegExp(phrases.map(escapeRegExp).join("|"), "giu") : undefined;
  }

  /** Personerna som ett objekt pekar på direkt (id eller samma för- och efternamn), eller undefined om det pekar på någon annan. */
  private owners(object: Record<string, unknown>): Person[] | "other" | undefined {
    const found = new Set<Person>();
    let other = false;
    let given: string | undefined, family: string | undefined;
    for (const [key, value] of Object.entries(object)) {
      if (typeof value !== "string") continue;
      const person = this.byId.get(value);
      if (person) found.add(person);
      else if (this.otherEntryIds.has(value)) other = true;
      const rule = ruleFor(key);
      if (rule === "given") given = lower(value);
      if (rule === "family") family = lower(value);
    }
    if (found.size === 0 && given !== undefined && family !== undefined) {
      for (const person of this.persons) if (person.given.has(given) && person.family.has(family)) found.add(person);
    }
    if (found.size > 0) return [...found];
    return other ? "other" : undefined;
  }

  /**
   * Ett värde som pekar ut personen: hela namnet eller ett id (Eventor, externt, bricka; minst fem tecken). Ett förnamn eller
   * efternamn ensamt ersätts bara i fält med det namnet (`ruleFor`), så att t.ex. ett efternamn som råkar vara "Ok" aldrig
   * ändrar ett resultats status. Tal ändras aldrig efter värdet (en tid kan vara lika med ett bricknummer).
   */
  private matches(value: string, scope: readonly Person[]): Rule | undefined {
    const key = lower(value), trimmed = value.trim();
    for (const person of scope) {
      if (person.phrases.has(key)) return "name";
      if (trimmed.length >= 5 && person.identifiers.has(trimmed)) return "delete";
    }
    return undefined;
  }

  /** Ett värde som ersätter personuppgiften (eller `undefined` = ta bort fältet). */
  private replacement(rule: Rule, nullable: boolean): unknown {
    switch (rule) {
      case "given": return ANONYMOUS_GIVEN_NAME;
      case "family": return ANONYMOUS_FAMILY_NAME;
      case "name": return ANONYMOUS_NAME;
      case "null": return nullable ? null : ANONYMOUS_NAME;
      case "delete": return undefined;
    }
  }

  string(value: string, scope: readonly Person[]): string {
    if (scope.length > 0) {
      const rule = this.matches(value, scope);
      if (rule) return rule === "delete" ? "" : String(this.replacement(rule, false));
    }
    if (/^\s*<(\?xml|[A-Za-z])/.test(value) && value.length > 40) return this.xml(value);
    return this.phrase ? value.replace(this.phrase, ANONYMOUS_NAME) : value;
  }

  /**
   * JSON: i ett objekt som pekar på personen (id eller samma för- och efternamn), eller överallt i en rad som handlar om
   * personen (`rowScope`), ersätts fälten efter namn. Ett objekt om personen i en lista ger inte sina barn personen (ett
   * inbäddat klassobjekt behåller sitt id); ett objekt som pekar på en annan deltagare lämnas orört.
   */
  json(value: unknown, rowScope: readonly Person[]): unknown {
    if (typeof value === "string") return this.string(value, rowScope);
    if (Array.isArray(value)) return value.map(item => this.json(item, rowScope));
    if (value === null || typeof value !== "object") return value;
    const object = value as Record<string, unknown>;
    const owners = this.owners(object);
    const here = owners === "other" ? [] : owners ?? rowScope;
    const inherited = owners === "other" ? [] : rowScope;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(object)) {
      const rule = here.length > 0 ? ruleFor(key) : undefined;
      if (rule && (typeof item === "string" || typeof item === "number" || (rule === "null" && item !== null && typeof item === "object"))) {
        if (rule === "name" && !(typeof item === "string" && this.matches(item, here))) { result[key] = this.json(item, inherited); continue; }
        const next = this.replacement(rule, true);
        if (next !== undefined) result[key] = next;
        continue;
      }
      result[key] = typeof item === "string" ? this.string(item, here) : this.json(item, inherited);
    }
    return result;
  }

  /** IOF XML: personens block får namnet "Anonym deltagare" utan födelsedatum, id, bricka, klubb och kontaktuppgifter. */
  xml(value: string): string {
    const blocks = /<(PersonEntry|PersonStart|PersonResult|TeamMemberEntry|TeamMemberStart|TeamMemberResult|Competitor)\b[\s\S]*?<\/\1>/g;
    const redacted = value.replace(blocks, block => {
      const family = /<Family>([\s\S]*?)<\/Family>/.exec(block)?.[1];
      const given = /<Given>([\s\S]*?)<\/Given>/.exec(block)?.[1];
      const ids = [...block.matchAll(/<Id\b[^>]*>([^<]*)<\/Id>/g)].map(match => match[1]!.trim());
      const person = this.persons.find(candidate =>
        (family !== undefined && given !== undefined && candidate.family.has(lower(xmlText(family))) && candidate.given.has(lower(xmlText(given))))
        || ids.some(id => candidate.identifiers.has(id)));
      if (!person) return block;
      return block
        .replace(/<Given>[\s\S]*?<\/Given>/g, `<Given>${ANONYMOUS_GIVEN_NAME}</Given>`)
        .replace(/<Family>[\s\S]*?<\/Family>/g, `<Family>${ANONYMOUS_FAMILY_NAME}</Family>`)
        .replace(/<Person\b([^>]*)>([\s\S]*?)<\/Person>/g, (_all, attributes: string, inner: string) =>
          `<Person${attributes}>${inner.replace(/\s*<Id\b[^>]*>[^<]*<\/Id>/g, "")}</Person>`)
        .replace(/\s*<(BirthDate|Nationality|Contact|Address)\b[^>]*\/>/g, "")
        .replace(/\s*<(BirthDate|Nationality|Contact|Address)\b[^>]*>[\s\S]*?<\/\1>/g, "")
        .replace(/\s*<ControlCard\b[^>]*\/>/g, "").replace(/\s*<ControlCard\b[^>]*>[\s\S]*?<\/ControlCard>/g, "")
        .replace(/\s*<Organisation\b[^>]*\/>/g, "").replace(/\s*<Organisation\b[^>]*>[\s\S]*?<\/Organisation>/g, "");
    });
    return this.phrase ? redacted.replace(this.phrase, ANONYMOUS_NAME) : redacted;
  }
}

async function loadPersons(tx: DbExecutor, raceId: string, entryIds: readonly string[] | "all"): Promise<{ persons: Person[]; others: Set<string> }> {
  const entries = (await tx.execute<{ id: string; public_result_id: string; given_name: string; family_name: string; organisation_name: string | null;
    eventor_person_id: string | null; external_id: string | null; anonymized_at: string | null }>(sql`select id, public_result_id, given_name,
      family_name, organisation_name, eventor_person_id, external_id, anonymized_at from entry where race_id = ${raceId}`)).rows;
  const wanted = entryIds === "all" ? undefined : new Set(entryIds);
  const targets = entries.filter(entry => entry.anonymized_at === null && (!wanted || wanted.has(entry.id)));
  const others = new Set(entries.filter(entry => !targets.includes(entry)).flatMap(entry => [entry.id, entry.public_result_id]));
  if (targets.length === 0) return { persons: [], others };
  const ids = `{${targets.map(entry => entry.id).join(",")}}`;
  // Tidigare namn (namnändringar) och brickorna.
  const history = (await tx.execute<{ entry_id: string; identity: { givenName?: string; familyName?: string } }>(sql`
    select entry_id, previous_identity as identity from entry_identity_change_request where race_id = ${raceId} and entry_id = any(${ids}::uuid[])
    union all select entry_id, identity from entry_identity_change_request where race_id = ${raceId} and entry_id = any(${ids}::uuid[])`)).rows;
  const cards = (await tx.execute<{ entry_id: string; card_number: string }>(sql`select entry_id, card_number from card_assignment
    where race_id = ${raceId} and entry_id = any(${ids}::uuid[])`)).rows;
  const persons = targets.map(entry => {
    const given = new Set([lower(entry.given_name)]), family = new Set([lower(entry.family_name)]);
    for (const row of history.filter(item => item.entry_id === entry.id)) {
      if (row.identity.givenName) given.add(lower(row.identity.givenName));
      if (row.identity.familyName) family.add(lower(row.identity.familyName));
    }
    const phrases = new Set<string>();
    for (const g of given) for (const f of family) for (const phrase of [`${g} ${f}`, `${f} ${g}`, `${f}, ${g}`]) phrases.add(phrase);
    const identifiers = new Set([entry.eventor_person_id, entry.external_id, ...cards.filter(card => card.entry_id === entry.id).map(card => card.card_number)]
      .filter((value): value is string => typeof value === "string" && value.trim().length >= 3));
    return { id: entry.id, publicResultId: entry.public_result_id, given, family, phrases, identifiers };
  });
  return { persons, others };
}

const TEXT_TYPES = new Set(["text", "jsonb"]);

/** Skriver om tabellens rader som nämner någon av personerna. Ger antal ändrade rader. */
async function scrubTable(tx: DbExecutor, raceId: string, eventId: string, table: (typeof RACE_BACKUP_TABLES)[number], columns: BackupColumn[],
  scrubber: Scrubber, prefilter: readonly string[] | undefined): Promise<number> {
  const editable = columns.filter(column => TEXT_TYPES.has(column.type) && !/card_number$/.test(column.name) && column.name !== "external_source");
  if (editable.length === 0) return 0;
  const uuids = columns.filter(column => column.type === "uuid").map(column => column.name);
  const select = [...new Set([...editable.map(column => column.name), ...uuids])].map(name => `t.${quoteIdentifier(name)}`).join(", ");
  const filter = prefilter && prefilter.length > 0
    ? sql.join([sql.raw(" and ("), sql.join(prefilter.map(token => sql`strpos(lower(to_jsonb(t)::text), ${token.toLowerCase()}) > 0`), sql.raw(" or ")), sql.raw(")")])
    : sql``;
  const rows = (await tx.execute<Record<string, unknown> & { otid_row: string }>(sql.join([
    sql.raw(`select t.ctid::text as otid_row, ${select} from ${quoteIdentifier(table.name)} t where `), table.scope(raceId, eventId), filter]))).rows;
  let changed = 0;
  for (const row of rows) {
    const scope = uuids.map(name => row[name]).filter((value): value is string => typeof value === "string")
      .map(value => scrubber.byId.get(value)).filter((person): person is Person => person !== undefined);
    const updates: [BackupColumn, unknown][] = [];
    for (const column of editable) {
      const value = row[column.name];
      if (value === null || value === undefined) continue;
      let next: unknown;
      if (column.type === "jsonb") next = scrubber.json(value, scope);
      else if (typeof value === "string") {
        const rule = scope.length > 0 ? ruleFor(column.name) : undefined;
        next = rule && rule !== "delete" && (rule !== "name" || scrubber.string(value, scope) !== value)
          ? (rule === "given" ? ANONYMOUS_GIVEN_NAME : rule === "family" ? ANONYMOUS_FAMILY_NAME : rule === "null" && column.nullable ? null : ANONYMOUS_NAME)
          : scrubber.string(value, scope);
      } else continue;
      if (JSON.stringify(next) !== JSON.stringify(value)) updates.push([column, next]);
    }
    if (table.name === "result_finalization" && updates.some(([column]) => column.name === "complete_xml")) {
      const xml = updates.find(([column]) => column.name === "complete_xml")![1] as string;
      const hash = columns.find(column => column.name === "complete_xml_hash");
      if (hash) updates.push([hash, sha256Hex(xml)]);
    }
    if (updates.length === 0) continue;
    await tx.execute(sql.join([sql.raw(`update ${quoteIdentifier(table.name)} set `), sql.join(updates.map(([column, value]) =>
      column.type === "jsonb" ? sql`${sql.identifier(column.name)} = ${JSON.stringify(value)}::jsonb` : sql`${sql.identifier(column.name)} = ${value as string | null}`),
    sql.raw(", ")), sql` where ctid = ${row.otid_row}::tid`]));
    changed += 1;
  }
  return changed;
}

export interface AnonymizationResult { readonly entries: number; readonly rows: number }

/**
 * Anonymiserar deltagarna (eller alla i tävlingen) i anroparens transaktion. Anroparen har behörigheten och har låst tävlingen.
 * Redan anonymiserade hoppas över. Ger antal deltagare och ändrade rader (inga namn).
 */
export async function anonymizeEntries(tx: DbExecutor, raceId: string, entryIds: readonly string[] | "all", now: Date): Promise<AnonymizationResult> {
  const { persons, others } = await loadPersons(tx, raceId, entryIds);
  if (persons.length === 0) return { entries: 0, rows: 0 };
  const [race] = (await tx.execute<{ event_id: string }>(sql`select event_id from race where id = ${raceId}`)).rows;
  if (!race) return { entries: 0, rows: 0 };
  const ids = `{${persons.map(person => person.id).join(",")}}`;
  await tx.execute(sql`select set_config('otid.anonymize', 'on', true)`);
  await tx.execute(sql`select set_config('otid.purge', 'on', true)`);
  // Namnändringarnas journal består bara av namnen; GPS-rutten och PDF:er som nämner deltagaren tas bort.
  await tx.execute(sql`delete from entry_identity_change_request where race_id = ${raceId} and entry_id = any(${ids}::uuid[])`);
  await tx.execute(sql`delete from participant_route where race_id = ${raceId} and entry_id = any(${ids}::uuid[])`);
  await tx.execute(sql`select set_config('otid.purge', 'off', true)`);
  const scrubber = new Scrubber(persons, others);
  const tokens = entryIds === "all" ? undefined : [...new Set(persons.flatMap(person =>
    [person.id, person.publicResultId, ...person.identifiers, ...[...person.family].filter(name => name.length >= 2)]))];
  const jobs = (await tx.execute<{ id: string; text: string }>(sql`select id, lower(coalesce(request::text, '') || coalesce(document::text, '')
    || coalesce(label, '')) as text from course_setting_print_job where race_id = ${raceId}`)).rows;
  const mentioned = jobs.filter(job => entryIds === "all" || tokens!.some(token => job.text.includes(token.toLowerCase())));
  if (mentioned.length > 0) await tx.execute(sql`delete from course_setting_print_job where id = any(${`{${mentioned.map(job => job.id).join(",")}}`}::uuid[])`);

  const catalog = await loadBackupCatalog(tx, RACE_BACKUP_TABLES.map(table => table.name));
  let rows = 0;
  for (const table of RACE_BACKUP_TABLES) {
    if (SKIPPED.has(table.name)) continue;
    rows += await scrubTable(tx, raceId, race.event_id, table, catalog.get(table.name)!.columns, scrubber, tokens);
  }
  await tx.execute(sql`update entry set given_name = ${ANONYMOUS_GIVEN_NAME}, family_name = ${ANONYMOUS_FAMILY_NAME}, organisation_name = null,
      eventor_person_id = null, eventor_organisation_id = null, external_source = null, external_id = null, anonymized_at = ${now},
      version = version + 1
    where race_id = ${raceId} and id = any(${ids}::uuid[])`);
  await tx.execute(sql`select set_config('otid.anonymize', 'off', true)`);
  await bumpReadoutPackageVersion(tx, raceId);
  return { entries: persons.length, rows };
}
