import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { isRaceStaff, publicRaceAccess, type PublicRaceAccess } from "@o-tid/application";
import { db } from "./db";
import { publicBusyResponse, publicLoad } from "./public-load";
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

/**
 * Steg 54: för besökare utan inloggning är svaret detsamma för alla (publicerad och inte dold), så det delas i högst en
 * sekund per tävling i stället för en databasfråga per anrop. En ändrad publicering syns inom en sekund.
 */
const ANONYMOUS_ACCESS_MS = 1_000;
const anonymousAccess = new Map<string, { at: number; value: Promise<PublicRaceAccess> }>();

/** För tester: glöm de delade svaren. */
export function clearAnonymousRaceAccess(): void { anonymousAccess.clear(); }

export async function raceAccess(raceId: string): Promise<PublicRaceAccess> {
  const token = await accountSessionToken();
  if (token !== null) return publicRaceAccess(db, raceId, token);
  const known = anonymousAccess.get(raceId);
  if (known && Date.now() - known.at < ANONYMOUS_ACCESS_MS) return known.value;
  const value = publicRaceAccess(db, raceId, null);
  anonymousAccess.set(raceId, { at: Date.now(), value });
  value.catch(() => { if (anonymousAccess.get(raceId)?.value === value) anonymousAccess.delete(raceId); });
  if (anonymousAccess.size > 500) anonymousAccess.delete(anonymousAccess.keys().next().value!);
  return value;
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
  // Steg 54 (ADR-0177): publiken utan inloggning får en plats i taget (kö, sist 503 med Retry-After); inloggade går före.
  const slot = await accountSessionToken() === null ? await publicLoad().admit() : undefined;
  if (slot?.kind === "busy") return publicBusyResponse(slot.retryAfterSeconds);
  try {
    const access = await raceAccess(raceId);
    if (access === "NONE") return Response.json({ formatVersion: 1, error: "NOT_FOUND" }, { status: 404, headers: { "cache-control": "no-store" } });
    const response = await respond();
    if (access === "PREVIEW") response.headers.set("cache-control", "private, no-store, no-transform");
    return response;
  } finally {
    slot?.release();
  }
}

/** Steg 52 (ADR-0176): den inloggade är arrangör eller funktionär på tävlingen och ser banorna även när de är hemliga. */
export async function raceStaff(raceId: string): Promise<boolean> {
  return isRaceStaff(db, raceId, await accountSessionToken());
}

/**
 * Som `publicRaceResponse`, men svaret får veta om den som frågar är arrangör eller funktionär (banorna visas då även när
 * de är hemliga publikt). Ett sådant svar sparas aldrig i en delad cache.
 */
export async function publicRaceStaffResponse(raceId: string, respond: (staff: boolean) => Promise<Response> | Response): Promise<Response> {
  return publicRaceResponse(raceId, async () => {
    const staff = await raceStaff(raceId);
    const response = await respond(staff);
    if (staff) response.headers.set("cache-control", "private, no-store, no-transform");
    return response;
  });
}
