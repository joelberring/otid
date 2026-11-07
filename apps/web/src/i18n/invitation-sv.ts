import type {
  ClubRole, GroupMemberRole, InvitationKind, InvitationMailOutcome, InvitationRole, MapProjectRole, RaceInvitationRole
} from "@o-tid/contracts";
import { plural } from "./plural";

/** ADR-0206: inbjudningar med e-post – mejlet, länksidan, listornas "Skicka igen"/"Kopiera länken" och flera adresser på en gång. */

/** Rollen i ord, i mejlet och på länksidan. */
export const invitationRoleWords: { CLUB: Record<ClubRole, string>; RACE: Record<RaceInvitationRole, string>;
  GROUP: Record<GroupMemberRole, string>; MAP_PROJECT: Record<MapProjectRole, string> } = {
  CLUB: { OWNER: "ägare", ADMIN: "administratör", LEADER: "ledare", READER: "medlem" },
  RACE: { ADMIN: "administratör", FUNCTIONARY: "funktionär", COURSE_EDIT: "banläggare – kan ändra",
    COURSE_SUGGEST: "banläggare – kan föreslå ändringar", COURSE_COMMENT: "banläggare – kan läsa och kommentera",
    COURSE_MAP: "kartritare – ser kartan och kartfelen" },
  GROUP: { LEADER: "ledare", MEMBER: "medlem" },
  MAP_PROJECT: { OWNER: "ägare", EDIT: "kartritare – kan ändra", SUGGEST: "kartritare – kan föreslå ändringar", READ: "kan läsa" }
};
export const invitationRoleWord = (kind: InvitationKind, role: InvitationRole) =>
  (invitationRoleWords[kind] as Partial<Record<InvitationRole, string>>)[role] ?? role.toLowerCase();

const longDate = (isoDate: string) => new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
  .format(new Date(`${isoDate}T12:00:00Z`));

/** "klubben OK Påhitt", "tävlingen Natt-KM den 7 oktober 2027", "träningsgruppen Torsdagsgänget", "kartprojektet Kungshatt". */
export function invitationTargetPhrase(kind: InvitationKind, name: string, raceDate: string | null): string {
  if (kind === "CLUB") return `klubben ${name}`;
  if (kind === "GROUP") return `träningsgruppen ${name}`;
  if (kind === "MAP_PROJECT") return `kartprojektet ${name}`;
  return raceDate ? `tävlingen ${name} den ${longDate(raceDate)}` : `tävlingen ${name}`;
}

export const invitationSv = {
  mail: {
    subject: (target: string) => `Inbjudan till ${target} i O-Tid`,
    invited: (inviter: string, target: string, role: string) => `${inviter} har bjudit in dig till ${target} i O-Tid som ${role}.`,
    open: "Öppna länken för att ta emot inbjudan. Där skapar du ett konto med den här adressen, eller loggar in om du redan har ett:",
    validUntil: (date: string) => `Länken gäller till ${date}. Inbjudan gäller när du har loggat in med den här adressen och bekräftat den.`,
    ignore: "Känner du inte igen inbjudan kan du strunta i meddelandet. Ingenting händer om du inte loggar in.",
    signature: "O-Tid"
  },
  page: {
    kicker: "O-Tid · Inbjudan",
    title: "Inbjudan",
    checking: "Hämtar inbjudan …",
    invalidTitle: "Inbjudan gäller inte längre",
    invalid: "Länken har gått ut, har ersatts av en nyare inbjudan eller så har inbjudan tagits bort. Har du fått ett nyare mejl, använd länken i det. Annars kan du be den som bjöd in dig att skicka igen.",
    noToken: "Länken saknar sin nyckel. Öppna länken i mejlet igen.",
    failed: "Inbjudan kunde inte hämtas. Försök igen.",
    invited: (inviter: string | null, target: string, role: string) =>
      `${inviter ?? "Du"} har ${inviter === null ? "bjudits in" : "bjudit in dig"} till ${target} som ${role}.`,
    address: (email: string) => `Inbjudan gäller adressen ${email}. Logga in med den adressen, eller skapa ett konto med den.`,
    howItWorks: "Inbjudan gäller när du är inloggad med adressen och har bekräftat den. Skapar du ett konto får du först ett mejl med en länk som bekräftar adressen.",
    validUntil: (date: string) => `Länken gäller till ${date}.`,
    register: "Skapa konto",
    login: "Logga in",
    open: "Öppna",
    otherAccount: (email: string) => `Du är inloggad som ${email}. Logga ut under Mina tävlingar och öppna länken igen för att logga in med adressen i inbjudan.`
  },
  list: {
    sent: (time: string) => `skickad ${time}`,
    notSent: "inte skickad",
    resend: "Skicka igen",
    resendLabel: (email: string) => `Skicka inbjudan igen till ${email}`,
    copy: "Kopiera länken",
    copyLabel: (email: string) => `Kopiera länken till inbjudan för ${email}`,
    resent: (email: string) => `Inbjudan är skickad igen till ${email}. Den tidigare länken gäller inte längre.`,
    copied: "Länken är kopierad. Skicka den själv till personen; den gäller i 14 dagar.",
    copyManually: "Kopiera länken här och skicka den själv till personen; den gäller i 14 dagar.",
    linkField: "Länk till inbjudan",
    throttled: "För många inbjudningar just nu. Vänta en stund och försök igen.",
    failed: "Inbjudan kunde inte skickas. Försök igen om en stund.",
    mailOff: "E-post är inte inställd på servern. Kopiera länken och skicka den själv."
  },
  bulk: {
    help: "En eller flera adresser, åtskilda med komma, mellanslag eller ny rad. Alla får samma roll och var sitt mejl.",
    tooMany: (max: number) => `Högst ${max} adresser på en gång.`,
    none: "Skriv minst en e-postadress.",
    working: (done: number, total: number) => `Sparar ${done} av ${total} …`
  }
} as const;

export interface InvitationTally { sent: number; saved: number; throttled: number; failed: number; invalid: number; existing: number; other: number }

const notSent = (n: number) => n === 1 ? "1 inbjudan sparad men inte skickad" : `${n} inbjudningar sparade men inte skickade`;

/**
 * Sammanfattningen efter flera adresser: "5 inbjudningar skickade, 1 adress var ogiltig". `saved` = sparade utan mejl (ingen
 * e-post på servern).
 */
export function invitationSummary(tally: InvitationTally): string {
  const parts = [
    tally.sent > 0 ? `${plural(tally.sent, "inbjudan", "inbjudningar")} ${tally.sent === 1 ? "skickad" : "skickade"}` : undefined,
    tally.saved > 0 ? `${plural(tally.saved, "inbjudan", "inbjudningar")} ${tally.saved === 1 ? "sparad" : "sparade"} (kopiera länken i listan och skicka den själv)` : undefined,
    tally.throttled > 0 ? `${notSent(tally.throttled)} (för många just nu, skicka igen senare)` : undefined,
    tally.failed > 0 ? `${notSent(tally.failed)} (försök Skicka igen)` : undefined,
    tally.existing > 0 ? `${plural(tally.existing, "adress", "adresser")} fanns redan i listan` : undefined,
    tally.invalid > 0 ? `${plural(tally.invalid, "adress", "adresser")} var ${tally.invalid === 1 ? "ogiltig" : "ogiltiga"}` : undefined,
    tally.other > 0 ? `${plural(tally.other, "adress", "adresser")} kunde inte sparas` : undefined
  ].filter((part): part is string => part !== undefined);
  if (parts.length === 0) return "Inga adresser.";
  const text = parts.join(", ");
  return `${text[0]!.toUpperCase()}${text.slice(1)}.`;
}

/** Vad som hände med mejlet för en enda adress, efter "sparad"-beskedet. */
export const invitationMailNote: Record<InvitationMailOutcome, string> = {
  sent: "En inbjudan med länk är skickad till adressen.",
  off: "E-post är inte inställd på servern: kopiera länken i listan och skicka den själv.",
  throttled: "Inbjudan skickades inte (för många just nu). Använd Skicka igen senare.",
  failed: "Inbjudan kunde inte skickas. Använd Skicka igen."
};
