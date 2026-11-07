import { mapStorageQuotaProblems, retentionSettingsProblems, serverWatchSettingsProblems } from "@o-tid/application";
import { mailConfiguration } from "./mail";
import { SecurityConfigurationError, securityPolicy } from "./security-policy";

/**
 * ADR-0186: inställningar som får servern att svara med ett tomt 500 (till exempel fel O_TID_PUBLIC_ORIGIN) skrivs i loggen
 * när servern startar, med vad som är fel och hur det rättas – aldrig med lösenord eller andra värden ur miljön.
 */
export function configurationProblems(environment: Partial<Record<string, string | undefined>> = process.env): string[] {
  const problems: string[] = [];
  if (!environment.DATABASE_URL?.trim()) problems.push("DATABASE_URL saknas: servern når inte databasen.");
  try {
    securityPolicy({ NODE_ENV: environment.NODE_ENV as NodeJS.ProcessEnv["NODE_ENV"], O_TID_PUBLIC_ORIGIN: environment.O_TID_PUBLIC_ORIGIN });
  } catch (error) {
    if (!(error instanceof SecurityConfigurationError)) throw error;
    problems.push(`O_TID_PUBLIC_ORIGIN är fel (${error.message}). Inloggning och alla skrivande anrop svarar 500. ` +
      "I drift ska den vara https://<OTID_DOMAIN> utan sökväg eller snedstreck på slutet (sätts i docker-compose.prod.yml).");
  }
  const mail = mailConfiguration(environment);
  if (mail.status === "invalid") {
    problems.push(`${mail.problem === "SMTP_URL" ? "OTID_SMTP_URL" : "OTID_MAIL_FROM"} är fel: e-posten är avstängd ` +
      "(glömt lösenord och bekräftelse av e-postadressen). Se docs/drift.md, E-post.");
  }
  // ADR-0205: Google-inloggningen kräver båda; med bara en syns ingen knapp.
  if (!!environment.OTID_GOOGLE_CLIENT_ID?.trim() !== !!environment.OTID_GOOGLE_CLIENT_SECRET?.trim()) {
    problems.push("Bara en av OTID_GOOGLE_CLIENT_ID och OTID_GOOGLE_CLIENT_SECRET är satt: Logga in med Google är avstängt. "
      + "Se docs/drift.md, Inloggning med Google.");
  }
  const role = environment.OTID_INSTANCE_ROLE?.trim().toLowerCase();
  if (role && role !== "competition" && role !== "public" && role !== "all") {
    problems.push(`OTID_INSTANCE_ROLE="${role}" är okänd; tillåtet är competition, public eller tom.`);
  }
  // ADR-0189 beslut 3: kartornas kvot.
  problems.push(...mapStorageQuotaProblems(environment).map(problem => `${problem}.`));
  // ADR-0189 beslut 6: gallringen.
  problems.push(...retentionSettingsProblems(environment).map(problem => `${problem}.`));
  problems.push(...serverWatchSettingsProblems(environment).map(problem => `${problem}.`));
  return problems;
}

export function logConfigurationProblems(environment: Partial<Record<string, string | undefined>> = process.env): void {
  for (const problem of configurationProblems(environment)) console.error(`KONFIGURATIONSFEL: ${problem}`);
}
