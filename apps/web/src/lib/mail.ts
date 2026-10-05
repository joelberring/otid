import nodemailer from "nodemailer";
import { normalizeAccountEmail } from "@o-tid/contracts";

/**
 * E-post från servern (ADR-0172 beslut 1), bara för återställningslänkar. Inställt i serverns miljö:
 * `OTID_SMTP_URL` (smtp://användare:lösen@värd:587 med STARTTLS, eller smtps://…:465) och `OTID_MAIL_FROM`
 * (avsändare, t.ex. "O-Tid <noreply@klubb.se>"). Utan `OTID_SMTP_URL` är e-post avstängd och sidan
 * "Glömt lösenord" hänvisar till den som driver O-Tid. Inga adresser, länkar eller lösenord loggas.
 */
export type MailConfiguration =
  | { status: "off" }
  | { status: "invalid"; problem: "SMTP_URL" | "MAIL_FROM" }
  | { status: "on"; smtpUrl: string; from: string };

type MailEnvironment = Record<string, string | undefined>;

function validFrom(value: string): boolean {
  const address = /<([^<>]+)>\s*$/.exec(value)?.[1] ?? value;
  return !/[\r\n]/.test(value) && normalizeAccountEmail(address) !== undefined;
}

export function mailConfiguration(environment: MailEnvironment = process.env): MailConfiguration {
  const smtpUrl = environment.OTID_SMTP_URL?.trim();
  if (!smtpUrl) return { status: "off" };
  let url: URL;
  try { url = new URL(smtpUrl); }
  catch { return { status: "invalid", problem: "SMTP_URL" }; }
  if ((url.protocol !== "smtp:" && url.protocol !== "smtps:") || !url.hostname) return { status: "invalid", problem: "SMTP_URL" };
  const from = environment.OTID_MAIL_FROM?.trim();
  if (!from || !validFrom(from)) return { status: "invalid", problem: "MAIL_FROM" };
  return { status: "on", smtpUrl, from };
}

/** Om sidan ska erbjuda länk via e-post. En felaktig inställning loggas (utan värden) och räknas som avstängd. */
export function mailEnabled(environment: MailEnvironment = process.env): Extract<MailConfiguration, { status: "on" }> | undefined {
  const configuration = mailConfiguration(environment);
  if (configuration.status === "invalid") {
    console.error(`E-post är felaktigt inställd (${configuration.problem === "SMTP_URL" ? "OTID_SMTP_URL" : "OTID_MAIL_FROM"}); `
      + "återställning via e-post är avstängd.");
  }
  return configuration.status === "on" ? configuration : undefined;
}

export interface PasswordResetMail { to: string; displayName: string; link: string; expiresAt: Date }

export function passwordResetMessage(mail: PasswordResetMail): { subject: string; text: string } {
  const time = new Intl.DateTimeFormat("sv-SE", { timeStyle: "short", timeZone: "Europe/Stockholm" }).format(mail.expiresAt);
  return {
    subject: "Återställ lösenordet till O-Tid",
    text: [
      `Hej ${mail.displayName}!`,
      "",
      "Någon (förhoppningsvis du) bad om ett nytt lösenord till ditt konto i O-Tid. Öppna länken och välj ett nytt lösenord:",
      "",
      mail.link,
      "",
      `Länken fungerar en gång och gäller till kl. ${time}. När lösenordet är bytt loggas du ut överallt.`,
      "Har du inte bett om detta kan du strunta i meddelandet; lösenordet är då oförändrat.",
      "",
      "O-Tid"
    ].join("\n")
  };
}

type Transport = { sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown> };
export type TransportFactory = (smtpUrl: string) => Transport;

export async function sendPasswordResetMail(
  configuration: Extract<MailConfiguration, { status: "on" }>,
  mail: PasswordResetMail,
  createTransport: TransportFactory = (smtpUrl) => nodemailer.createTransport(smtpUrl)
): Promise<void> {
  const message = passwordResetMessage(mail);
  await createTransport(configuration.smtpUrl).sendMail({ from: configuration.from, to: mail.to, ...message });
}

/** Felets kod, utan meddelandet (som kan innehålla mottagarens adress). */
export function mailErrorSummary(error: unknown): string {
  if (error && typeof error === "object") {
    const { code, responseCode } = error as { code?: unknown; responseCode?: unknown };
    return [typeof code === "string" ? code : undefined, typeof responseCode === "number" ? String(responseCode) : undefined]
      .filter(Boolean).join(" ") || "okänt fel";
  }
  return "okänt fel";
}
