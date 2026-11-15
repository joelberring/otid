import { readRaceShortcut } from "@o-tid/application";
import type { Database } from "@o-tid/database";
import { privateJson } from "./security-policy";
import { guarded, readProof, type ClubEnvironment } from "./club-route-handlers";

/**
 * Ägaren 2026-11-15: snabblänken på tävlingssidan till arbetsytan (`?code=<kortkod>`). Svaret är alltid privat och utan cache;
 * utan inloggning eller behörighet är det `admin: null`, samma som för en okänd kod.
 */
export async function raceShortcutRoute(db: Database, request: Request, environment: ClubEnvironment = process.env): Promise<Response> {
  const input = await readProof(request, environment);
  if ("response" in input) return input.response;
  const code = (new URL(request.url).searchParams.get("code") ?? "").slice(0, 40);
  return guarded(async () => privateJson(await readRaceShortcut(db, { sessionToken: input.proof.sessionToken, code })));
}
