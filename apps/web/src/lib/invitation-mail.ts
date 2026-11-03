import type { InvitationMail, InvitationMailer } from "@o-tid/application";
import { invitationRoleWord, invitationSv, invitationTargetPhrase } from "../i18n/invitation-sv";
import { mailEnabled, mailErrorSummary, sendMessage, type TransportFactory } from "./mail";

/**
 * ADR-0206: mejlet med inbjudan. Vanlig svenska utan något om mottagaren: vem som bjuder in (visningsnamnet), till vad (klubbens,
 * tävlingens och datumet eller gruppens namn), rollen i ord och en länk. Nyckeln står efter # (som återställningslänken), så att
 * den inte hamnar i serverns loggar när sidan öppnas.
 */
const text = invitationSv.mail;

/** Rubriker och namn är fri text från användare: inga radbrytningar eller styrtecken i ämnesraden. */
const oneLine = (value: string) => value.replace(/[\p{Cc}\u2028\u2029]+/gu, " ").replace(/\s+/g, " ").trim();

export function invitationLink(publicOrigin: string, token: string): string {
  return `${publicOrigin}/inbjudan#token=${token}`;
}

export function invitationMessage(mail: InvitationMail, link: string): { subject: string; text: string } {
  const target = invitationTargetPhrase(mail.target.kind, oneLine(mail.target.name), mail.target.kind === "RACE" ? mail.target.raceDate : null);
  const until = new Intl.DateTimeFormat("sv-SE", { dateStyle: "long", timeZone: "Europe/Stockholm" }).format(mail.expiresAt);
  return {
    subject: oneLine(text.subject(target)).slice(0, 200),
    text: [
      "Hej!",
      "",
      text.invited(oneLine(mail.inviterName), target, invitationRoleWord(mail.target.kind, mail.role)),
      "",
      text.open,
      "",
      link,
      "",
      text.validUntil(until),
      text.ignore,
      "",
      text.signature
    ].join("\n")
  };
}

type Environment = Record<string, string | undefined>;

/**
 * Mejlaren när e-post är inställd (`OTID_SMTP_URL`), annars undefined (då visar listorna "Kopiera länken"). Fel loggas med en
 * kort kod, aldrig med adress eller länk, och kastas vidare så att inbjudan visas som inte skickad.
 */
export function invitationMailer(environment: Environment, publicOrigin: string,
  send: typeof sendMessage = sendMessage, createTransport?: TransportFactory): InvitationMailer | undefined {
  const configuration = mailEnabled(environment);
  if (!configuration) return undefined;
  return async (mail) => {
    try {
      await send(configuration, mail.to, invitationMessage(mail, invitationLink(publicOrigin, mail.token)), createTransport);
    } catch (error) {
      console.error(`Inbjudan kunde inte skickas (${mailErrorSummary(error)}).`);
      throw error;
    }
  };
}
