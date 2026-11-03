import {
  addAccountClub, answerAccountClubStep, decideClubAffiliation, eventorConfigurationFromEnvironment, linkClubToEventor, liftRaceToClubArchive,
  readAccountClubs, readClubAffiliation, readRaceClubArchiveAsAdmin, removeAccountClub, removeRaceFromClubArchive, searchOrganisationsForAccount,
  setClubAccessSettings, setRaceOrganiserAsAdmin, syncClubEventorMembersAsAdmin, unlinkClubFromEventor
} from "@o-tid/application";
import { clubEventorLinkRequestSchema, UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { accountFailure, privateJson } from "./security-policy";
import { failure, guarded, mutation, readProof, type ClubEnvironment } from "./club-route-handlers";

/**
 * ADR-0209: klubbtillhörighetens anrop. Samma skydd som klubbens (exakt Origin och CSRF på skrivningar, privata svar utan
 * cache). Klubbens Eventor-nyckel tas emot en gång i "Koppla till Eventor" och skickas aldrig tillbaka; den finns inte i
 * något svar eller någon logg (felen är koder).
 */
type Environment = ClubEnvironment & Partial<Pick<NodeJS.ProcessEnv, "OTID_EVENTOR_MASTER_KEY" | "OTID_EVENTOR_BASE_URL">>;
const validId = (id: string) => UUID_PATTERN.test(id);

function problem(code: string, status = 409): Response {
  return privateJson({ formatVersion: 1, error: code }, status);
}

// --- Klubblistan och Mina klubbar ------------------------------------------------------------------------------------------------

export async function organisationSearchRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  const input = await readProof(request, environment);
  if ("response" in input) return input.response;
  const query = new URL(request.url).searchParams.get("q") ?? "";
  return guarded(async () => {
    const result = await searchOrganisationsForAccount(db, input.proof, query);
    return result.status === "ok" ? privateJson(result.response) : failure(result.status);
  });
}

/** GET Mina klubbar, POST lägg till, DELETE ta bort. */
export async function accountClubsRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await readAccountClubs(db, input.proof);
      return result.status === "ok" ? privateJson(result.response) : failure(result.status);
    });
  }
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = request.method === "POST" ? await addAccountClub(db, { ...input.proof, request: input.body })
      : await removeAccountClub(db, { ...input.proof, request: input.body });
    return result.status === "added" || result.status === "removed" ? privateJson(result.response, result.status === "added" ? 201 : 200)
      : failure(result.status);
  });
}

/** Steget efter registreringen ("Vilken klubb tillhör du?"): spara eller hoppa över. */
export async function accountClubStepRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await answerAccountClubStep(db, { ...input.proof, request: input.body });
    return result.status === "ok" ? privateJson(result.response) : failure(result.status);
  });
}

// --- Klubbarkivet ---------------------------------------------------------------------------------------------------------------

/** GET kopplingen, bekräftelserna och Vem ser vad; PUT Vem ser vad. Bara ägare och administratörer. */
export async function clubAffiliationRoute(db: Database, request: Request, clubId: string, environment: Environment = process.env): Promise<Response> {
  if (!validId(clubId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await readClubAffiliation(db, { ...input.proof, clubId });
      return result.status === "ok" ? privateJson(result.view) : failure(result.status);
    });
  }
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await setClubAccessSettings(db, { ...input.proof, clubId, request: input.body });
    return result.status === "ok" ? privateJson(result.view) : failure(result.status);
  });
}

export async function clubAffiliationDecisionRoute(db: Database, request: Request, clubId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(clubId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await decideClubAffiliation(db, { ...input.proof, clubId, request: input.body });
    return result.status === "ok" ? privateJson(result.view) : failure(result.status);
  });
}

/** PUT "Koppla till Eventor" / "Byt nyckel" (nyckeln i kroppen), DELETE "Ta bort kopplingen", POST "Hämta medlemmar nu". */
export async function clubEventorRoute(db: Database, request: Request, clubId: string, environment: Environment = process.env): Promise<Response> {
  if (!validId(clubId)) return failure("not-found");
  const configuration = eventorConfigurationFromEnvironment(environment);
  const input = await mutation(request, environment, request.method === "PUT" ? "json" : "none");
  if ("response" in input) return input.response;
  return guarded(async () => {
    if (request.method === "PUT") {
      const parsed = clubEventorLinkRequestSchema.safeParse(input.body);
      if (!parsed.success) return problem("INVALID_KEY", 422);
      const result = await linkClubToEventor(db, { ...input.proof, clubId, apiKey: parsed.data.apiKey, configuration });
      if (result.status === "problem") return problem(result.problem, result.problem === "ALREADY_LINKED" ? 409 : 422);
      return result.status === "linked" ? privateJson({ formatVersion: 1, organisationName: result.organisationName }) : failure(result.status);
    }
    if (request.method === "DELETE") {
      const result = await unlinkClubFromEventor(db, { ...input.proof, clubId });
      return result.status === "unlinked" ? privateJson({ formatVersion: 1, status: "unlinked" }) : failure(result.status);
    }
    const result = await syncClubEventorMembersAsAdmin(db, { ...input.proof, clubId, configuration });
    if (result.status === "problem") return problem(result.problem, result.problem === "TOO_SOON" ? 429 : 422);
    return result.status === "synced" ? privateJson({ formatVersion: 1, members: result.members, confirmed: result.confirmed, withdrawn: result.withdrawn })
      : failure(result.status);
  });
}

// --- Tävlingen och klubbarkivet -------------------------------------------------------------------------------------------------

/** GET läget, PUT arrangörsklubben, POST "Lägg i klubbarkivet", DELETE "Ta ur klubbarkivet". Bara tävlingens administratörer. */
export async function raceClubArchiveRoute(db: Database, request: Request, raceId: string, environment: Environment = process.env): Promise<Response> {
  if (!validId(raceId)) return accountFailure(404, "NOT_FOUND");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await readRaceClubArchiveAsAdmin(db, { ...input.proof, raceId });
      return result.status === "ok" ? privateJson(result.view) : failure(result.status);
    });
  }
  const input = await mutation(request, environment, request.method === "DELETE" ? "none" : "json");
  if ("response" in input) return input.response;
  const proof = { raceId, sessionToken: input.proof.sessionToken, csrfCookie: input.proof.csrfCookie, csrfHeader: input.proof.csrfHeader };
  return guarded(async () => {
    const result = request.method === "PUT" ? await setRaceOrganiserAsAdmin(db, { ...proof, request: input.body })
      : request.method === "POST" ? await liftRaceToClubArchive(db, { ...proof, request: input.body })
        : await removeRaceFromClubArchive(db, proof);
    if (result.status === "ok") return privateJson(result.view);
    if (result.status === "no-space") return problem("NO_CLUB_ARCHIVE");
    if (result.status === "secret") return problem("COURSES_SECRET");
    if (result.status === "already") return problem("ALREADY_IN_ARCHIVE");
    if (result.status === "not-lifted") return failure("not-found");
    return failure(result.status);
  });
}
