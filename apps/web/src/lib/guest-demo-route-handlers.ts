import { authenticateUserAccountSession, startGuestDemo } from "@o-tid/application";
import type { Database } from "@o-tid/database";
import { SecurityConfigurationError, clientAddress, hasExpectedOrigin, privateHeaders, securityPolicy, sessionProof, setSessionCookies }
  from "./security-policy";
import { languageOfRequest } from "./language";
import { guestDemoRaceEn, guestDemoRaceSv } from "../i18n/guest-demo";
import { logServerError } from "./server-error-log";

type Environment = Partial<Record<string, string | undefined>>;

/** Demoläget del 2: "Prova arbetsytan" visas och fungerar bara med `OTID_GUEST_DEMO=1`. */
export function guestDemoEnabled(environment: Environment = process.env): boolean {
  return environment.OTID_GUEST_DEMO?.trim() === "1";
}

/** Gästkonton per IP och timme (`OTID_GUEST_DEMO_PER_HOUR`, förval 5). */
export function guestsPerHour(environment: Environment): number | undefined {
  const value = environment.OTID_GUEST_DEMO_PER_HOUR?.trim();
  return value && /^[1-9]\d{0,3}$/.test(value) ? Number(value) : undefined;
}

function redirect(path: string): Response {
  return new Response(null, { status: 303, headers: { ...privateHeaders, location: path } });
}

/**
 * Formuläret på startsidan (POST, utan skript): skapar gästkontot med övningstävlingen, loggar in det och går till arbetsytan.
 * Den som redan är inloggad med ett eget konto loggas inte ut, utan går till Mina tävlingar. Spärren och fel ger startsidan
 * med ett besked (`/?demo=upptaget`, `/?demo=fel`).
 */
export async function guestDemoRoute(db: Database, request: Request, environment: Environment = process.env,
  start: typeof startGuestDemo = startGuestDemo, authenticate: typeof authenticateUserAccountSession = authenticateUserAccountSession)
  : Promise<Response> {
  if (!guestDemoEnabled(environment)) return new Response(null, { status: 404, headers: privateHeaders });
  let policy;
  try { policy = securityPolicy(environment); }
  catch (error) {
    if (error instanceof SecurityConfigurationError) return new Response(null, { status: 500, headers: privateHeaders });
    throw error;
  }
  if (!hasExpectedOrigin(request, policy)) return new Response(null, { status: 403, headers: privateHeaders });
  try {
    const current = await authenticate(db, { ...sessionProof(request, policy, false), allowGuest: true });
    if (current.status === "authenticated" && !current.principal.guestExpiresAt) return redirect("/organizer");
    const english = languageOfRequest(request) === "en";
    const limit = guestsPerHour(environment);
    const result = await start(db, { clientKey: clientAddress(request), ...(limit ? { guestsPerHour: limit } : {}),
      ...(english ? { displayName: guestDemoRaceEn.displayName, texts: guestDemoRaceEn.race }
        : { displayName: guestDemoRaceSv.displayName, texts: guestDemoRaceSv.race }) });
    if (result.status === "rate-limited") return redirect("/?demo=upptaget");
    if (result.status !== "created") return redirect("/?demo=fel");
    return setSessionCookies(redirect(`/admin/${result.raceId}/manage`), policy,
      { sessionToken: result.sessionToken, csrfToken: result.csrfToken, expiresAt: result.sessionExpiresAt });
  } catch (error) {
    logServerError("guest-demo", "guestDemoRoute", error);
    return redirect("/?demo=fel");
  }
}
