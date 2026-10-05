import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { publicRaceAccess, type PublicRaceAccess } from "@o-tid/application";
import { db } from "./db";
import { organizerAccountSessionCookieName } from "./organizer-account-cookies";

/**
 * Den enda grinden för publika sidor och API:er (ADR-0172 beslut 4): tävlingen syns när den är publicerad och
 * inte dold av superadmin (`publicRaceAccess`). Ägare, administratörer och funktionärer som är inloggade med
 * kontot ser en opublicerad tävling som förhandsvisning. Allt annat ger 404 utan namn.
 */
const SESSION_TOKEN = /^[A-Za-z0-9._~-]{1,256}$/;

/** Kontots sessionscookie, om den finns och ser rimlig ut. Själva kontrollen görs i tjänsterna. */
export async function accountSessionToken(): Promise<string | null> {
  const value = (await cookies()).get(organizerAccountSessionCookieName())?.value;
  return value && SESSION_TOKEN.test(value) ? value : null;
}

export async function raceAccess(raceId: string): Promise<PublicRaceAccess> {
  return publicRaceAccess(db, raceId, await accountSessionToken());
}

/** För publika sidor: ger PUBLIC eller PREVIEW, annars sidan "Tävlingen är inte publicerad" (404). */
export async function requirePublicRace(raceId: string): Promise<"PUBLIC" | "PREVIEW"> {
  const access = await raceAccess(raceId);
  if (access === "NONE") notFound();
  return access;
}

/**
 * För publika API:er, resultatströmmen och exporterna: 404 när tävlingen inte syns, annars svaret. En
 * förhandsvisning får aldrig sparas i en delad cache.
 */
export async function publicRaceResponse(raceId: string, respond: () => Promise<Response> | Response): Promise<Response> {
  const access = await raceAccess(raceId);
  if (access === "NONE") return Response.json({ formatVersion: 1, error: "NOT_FOUND" }, { status: 404, headers: { "cache-control": "no-store" } });
  const response = await respond();
  if (access === "PREVIEW") response.headers.set("cache-control", "private, no-store, no-transform");
  return response;
}
