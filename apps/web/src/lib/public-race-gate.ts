import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { authenticateUserAccountSession, isRaceStaff, publicRaceGate, type PublicRaceAccess } from "@o-tid/application";
import { db } from "./db";
import { publicBusyResponse, publicLoad } from "./public-load";
import { organizerAccountSessionCookieName } from "./organizer-account-cookies";
import { logServerError } from "./server-error-log";

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

/** Hur länge en prövad session räknas som inloggad utan ny kontroll, och hur många som minns (granskningen 3.3). */
const VERIFIED_TTL_MS = 30_000;
const VERIFIED_MAX = 500;
const verifiedSessions = new Map<string, number>();

/**
 * Är kakan en giltig session? Lastskyddet släpper bara förbi inloggade, så en påhittad kaka får inte räcka. En giltig session
 * minns i 30 sekunder (nyckeln är en hash av kakan, ogiltiga minns aldrig), så att inloggade inte kostar en kontroll per anrop.
 * Går kontrollen inte att göra räknas anroparen som publik.
 */
export async function hasVerifiedAccountSession(now = Date.now()): Promise<boolean> {
  const token = await accountSessionToken();
  if (token === null) return false;
  const key = createHash("sha256").update(token).digest("hex");
  const until = verifiedSessions.get(key);
  if (until !== undefined && until > now) return true;
  verifiedSessions.delete(key);
  try {
    const auth = await authenticateUserAccountSession(db, { sessionToken: token, allowGuest: true });
    if (auth.status !== "authenticated") return false;
  } catch (error) {
    logServerError("public-race-gate", "hasVerifiedAccountSession", error);
    return false;
  }
  if (verifiedSessions.size >= VERIFIED_MAX) {
    for (const [stored, expires] of verifiedSessions) if (expires <= now) verifiedSessions.delete(stored);
    if (verifiedSessions.size >= VERIFIED_MAX) verifiedSessions.delete(verifiedSessions.keys().next().value as string);
  }
  verifiedSessions.set(key, now + VERIFIED_TTL_MS);
  return true;
}

export async function raceAccess(raceId: string): Promise<PublicRaceAccess> {
  return (await raceGate(raceId)).access;
}

/** Steg 68: som `raceAccess`, och om svaret är privat (en träningsgrupp vars sida bara är för inloggade medlemmar). */
export async function raceGate(raceId: string): Promise<{ access: PublicRaceAccess; privateCache: boolean }> {
  return publicRaceGate(db, raceId, await accountSessionToken());
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
  const slot = await hasVerifiedAccountSession() ? undefined : await publicLoad().admit();
  if (slot?.kind === "busy") return publicBusyResponse(slot.retryAfterSeconds);
  try {
    const { access, privateCache } = await raceGate(raceId);
    if (access === "NONE") return Response.json({ formatVersion: 1, error: "NOT_FOUND" }, { status: 404, headers: { "cache-control": "no-store" } });
    const response = await respond();
    if (access === "PREVIEW" || privateCache) response.headers.set("cache-control", "private, no-store, no-transform");
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
