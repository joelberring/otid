import { attribute, many, record, textOf, type XmlRecord } from "./xml";
import { streamElements } from "./stream";

/**
 * ADR-0209 beslut B: klubbens medlemslista (`GET /api/persons/organisations/{id}?includeContactDetails=true`) läses bara
 * för att känna igen medlemmarnas e-postadresser. Av varje person tas Eventors person-id och adressernas hash
 * (`hashEmail`, en nyckelad HMAC som anroparen räknar); allt annat (namn, födelsedatum, adresser, telefon) lämnas direkt
 * och lämnar aldrig tolkningen. Adressen läses ur Eventors äldre `<Tele mailAddress="…">`, `<EMail>` eller IOF 3.0
 * `<Contact type="EmailAddress">`. Strukturen är inte provad mot riktiga Eventor.
 */
export const MAX_MEMBERS = 50_000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}$/;

export interface EventorMemberHash {
  readonly personId: string;
  readonly emailHashes: readonly string[];
}

/** Normaliserad adress: utan blanktecken runt, gemener (som kontots adress). */
export function normalizeMemberEmail(value: string): string | undefined {
  const email = value.trim().toLowerCase();
  return EMAIL.test(email) && email.length <= 254 ? email : undefined;
}

function personId(person: XmlRecord): string | undefined {
  const value = textOf(person.PersonId) ?? textOf(many(person.Id)[0]);
  return value !== undefined && ID.test(value) ? value : undefined;
}

function emails(person: XmlRecord): string[] {
  const found: string[] = [];
  for (const tele of many(person.Tele)) { const value = attribute(tele, "mailAddress"); if (value) found.push(value); }
  for (const value of many(person.EMail)) { const text = textOf(value); if (text) found.push(text); }
  for (const contact of many(person.Contact)) {
    if (attribute(contact, "type")?.toLowerCase() === "emailaddress") { const text = textOf(contact); if (text) found.push(text); }
  }
  // Ibland ligger adressen under ett kontaktelement (äldre format med `<ContactDetails>`).
  for (const details of many(person.ContactDetails)) {
    const inner = record(details);
    if (inner) found.push(...emails(inner));
  }
  return found;
}

/** Läser listan som ström och ger person-id med adressernas hash. Personer utan id eller adress hoppas över. */
export async function parseEventorMemberStream(chunks: AsyncIterable<string>, hashEmail: (email: string) => string)
  : Promise<readonly EventorMemberHash[]> {
  const members: EventorMemberHash[] = [];
  await streamElements(chunks, "PersonList", "Person", { maxElements: MAX_MEMBERS }, (element) => {
    const id = personId(element);
    if (!id) return;
    const hashes = [...new Set(emails(element).map(normalizeMemberEmail).filter((email): email is string => !!email).map(hashEmail))];
    if (hashes.length > 0) members.push({ personId: id, emailHashes: hashes });
  });
  return members;
}
