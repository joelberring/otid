import { resolveJoinCode } from "@o-tid/application";
import { db } from "../../lib/db";
import { joinCodeLocation } from "../../lib/join-code";
import { accountSessionToken } from "../../lib/public-race-gate";
import { clientAddressFrom } from "../../lib/security-policy";

/**
 * Översynen av startsidan 2026-11-17: formuläret "Har du en kod?" (GET, fungerar utan JavaScript). Koden slås upp på servern
 * och besökaren skickas till tävlingen (/t/), festen (/fest/) eller gruppen (/g/), annars tillbaka till startsidan med ett
 * besked. Koden står aldrig i adressen tillbaka.
 */
export async function GET(request: Request): Promise<Response> {
  const code = new URL(request.url).searchParams.get("kod") ?? "";
  const result = code.trim() ? await resolveJoinCode(db, { code, sessionToken: await accountSessionToken(), clientKey: clientAddressFrom(request.headers) })
    : undefined;
  return new Response(null, { status: 303, headers: { location: joinCodeLocation(result), "cache-control": "private, no-store" } });
}
