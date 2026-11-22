import { after } from "next/server";
import { recordVisit, type VisitorStep } from "@o-tid/application";
import { publicDb } from "./db";
import { clientAddressFrom } from "./security-policy";
import { logServerError } from "./server-error-log";
import { visitWorthCounting } from "./visitor-filter";

/**
 * Räknar en besökare i ett steg i besöksstatistiken (`recordVisit`) efter att svaret skickats (`after`), så att sidan inte väntar
 * på databasen och visas även om skrivningen misslyckas (felet loggas). Publikens pool (med tidsgräns) används i alla instanser.
 * Adressen läses som för spärrarna (X-Forwarded-For från Caddy) och används bara till dygnets hash; den sparas aldrig.
 */
export function countVisit(step: VisitorStep, headers: Pick<Headers, "get">): void {
  if (!visitWorthCounting(headers)) return;
  const address = clientAddressFrom(headers);
  const userAgent = headers.get("user-agent") ?? "";
  after(async () => {
    try { await recordVisit(publicDb, { step, address, userAgent }); }
    catch (error) { logServerError("visitors", `recordVisit:${step}`, error); }
  });
}
