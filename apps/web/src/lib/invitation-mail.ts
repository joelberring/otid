import type { InvitationMail, InvitationMailer } from "@o-tid/application";
import { invitationRoleWord, invitationSv, invitationTargetPhrase } from "../i18n/invitation-sv";
import { invitationMailEn, invitationRoleWordEn, invitationTargetPhraseEn } from "../i18n/workspace-last-en";
import type { Language } from "./language";
import { mailEnabled, mailErrorSummary, sendMessage, type TransportFactory } from "./mail";

/**
 * ADR-0206: mejlet med inbjudan, på svenska eller engelska efter språket hos den som bjuder in. Vanligt språk utan något om mottagaren: vem som bjuder in (visningsnamnet), till vad (klubbens,
 * tävlingens och datumet eller gruppens namn), rollen i ord och en länk. Nyckeln står efter # (som återställningslänken), så att
 * den inte hamnar i serverns loggar när sidan öppnas.
 */
/** Rubriker och namn är fri text från användare: inga radbrytningar eller styrtecken i ämnesraden. */
const oneLine = (value: string) => value.replace(/[\p{Cc}\u2028\u2029]+/gu, " ").replace(/\s+/g, " ").trim();

export function invitationLink(publicOrigin: string, token: string): string {
  return `${publicOrigin}/inbjudan#token=${token}`;
}

export function invitationMessage(mail: InvitationMail, link: string, language: Language = "sv"): { subject: string; text: string } {
  const en = language === "en", text = en ? invitationMailEn : invitationSv.mail;
  const target = (en ? invitationTargetPhraseEn : invitationTargetPhrase)(mail.target.kind, oneLine(mail.target.name), mail.target.kind === "RACE" ? mail.target.raceDate : null);
  const until = new Intl.DateTimeFormat(en ? "en-GB" : "sv-SE", { dateStyle: "long", timeZone: "Europe/Stockholm" }).format(mail.expiresAt);
  return {
    subject: oneLine(text.subject(target)).slice(0, 200),
    text: [
      text.greeting,
      "",
      text.invited(oneLine(mail.inviterName), target, (en ? invitationRoleWordEn : invitationRoleWord)(mail.target.kind, mail.role)),
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
  send: typeof sendMessage = sendMessage, createTransport?: TransportFactory, language: Language = "sv"): InvitationMailer | undefined {
  const configuration = mailEnabled(environment);
  if (!configuration) return undefined;
  return async (mail) => {
    try {
      await send(configuration, mail.to, invitationMessage(mail, invitationLink(publicOrigin, mail.token), language), createTransport);
    } catch (error) {
      console.error(`Inbjudan kunde inte skickas (${mailErrorSummary(error)}).`);
      throw error;
    }
  };
}
