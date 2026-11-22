import type { RawLaserMail } from "@o-tid/application";
import { mailEnabled, sendMessage } from "./mail";

/**
 * PLAN.md M6: mejlet med hämtningslänken till rå laserdata. Länken är försignerad direkt mot objektlagringen och gäller lika
 * länge som filen finns (7 dygn). Lantmäteriets villkor står med, eftersom de gäller den som hämtar.
 */
export function rawLaserMessage(mail: RawLaserMail): { subject: string; text: string } {
  const until = new Intl.DateTimeFormat("sv-SE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Stockholm" }).format(mail.expiresAt);
  const megabytes = Math.max(1, Math.round(mail.byteSize / (1024 * 1024)));
  return {
    subject: "Rå laserdata från O-Tid",
    text: [
      `Hej ${mail.displayName}!`,
      "",
      `Laserdatan från körningen «${mail.runName}» ligger i en zip-fil (${megabytes} MB) som du kan hämta här:`,
      "",
      mail.url,
      "",
      `Länken gäller till ${until}. Sedan tas filen bort automatiskt.`,
      "Lantmäteriets villkor för laserdata gäller den som hämtar (CC BY 4.0, ange källan ©Lantmäteriet; laserdata kan innehålla personuppgifter).",
      "",
      "O-Tid"
    ].join("\n")
  };
}

/** Skickar mejlet; ger false när e-post är avstängd. Fel kastas till anroparen (som loggar utan adress och länk). */
export async function sendRawLaserMail(mail: RawLaserMail, environment: Record<string, string | undefined> = process.env, send: typeof sendMessage = sendMessage): Promise<boolean> {
  const configuration = mailEnabled(environment);
  if (!configuration) return false;
  await send(configuration, mail.to, rawLaserMessage(mail));
  return true;
}
