import {
  changeClubTerm, createClubTerm, createPlannedRace, createPlanSessions, createPlanTask, listMyPlanTasks, readClubPlan, removePlanSession,
  removePlanTask, setPlanTaskDone, updatePlanSession, type PlanTaskMail, type PlanTaskMailer
} from "@o-tid/application";
import { UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { clubPlanningEn } from "../i18n/club-planning-en";
import { clubPlanningSv } from "../i18n/club-planning-sv";
import { failure, guarded, mutation, problem, readProof, type ClubEnvironment } from "./club-route-handlers";
import { requestLanguage, type Language } from "./language";
import { mailEnabled, mailErrorSummary, sendMessage } from "./mail";
import { privateJson, securityPolicy } from "./security-policy";

/**
 * ADR-0221: terminsplaneringen under /api/organizer/clubs/[clubId]/planning/… och Mina uppgifter under
 * /api/organizer/plan-tasks. Behörigheten avgörs i tjänsterna (ledare och mer för planen, den med uppgiften för "klar").
 */
const oneLine = (value: string) => value.replace(/[\p{Cc}\u2028\u2029]+/gu, " ").replace(/\s+/g, " ").trim();

/** Mejlet om en uppgift, på språket hos den som gav uppgiften. Inga adresser i texten utom länken. */
export function planTaskMessage(mail: PlanTaskMail, link: string, language: Language = "sv"): { subject: string; text: string } {
  const text = language === "en" ? clubPlanningEn.mail : clubPlanningSv.mail;
  const date = new Intl.DateTimeFormat(language === "en" ? "en-GB" : "sv-SE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
    .format(new Date(`${mail.sessionDate}T12:00:00Z`));
  return {
    subject: oneLine(text.subject(oneLine(mail.taskTitle), date)).slice(0, 200),
    text: [text.greeting, "", text.body(oneLine(mail.inviterName), oneLine(mail.clubName), oneLine(mail.taskTitle)),
      text.when(oneLine(mail.sessionTitle), date, mail.startTime, oneLine(mail.place)), "", text.open, "", link, "", text.ignore, "", text.signature].join("\n")
  };
}

function planTaskMailer(environment: ClubEnvironment, request: Request): PlanTaskMailer | undefined {
  const configuration = mailEnabled(environment);
  if (!configuration) return undefined;
  let origin: string;
  try { origin = securityPolicy(environment).publicOrigin; } catch { return undefined; }
  const language = requestLanguage(request);
  return async mail => {
    try { await sendMessage(configuration, mail.to, planTaskMessage(mail, `${origin}/organizer`, language)); }
    catch (error) {
      console.error(`Uppgiften kunde inte mejlas (${mailErrorSummary(error)}).`);
      throw error;
    }
  };
}

const ok = (body: object = {}) => privateJson({ formatVersion: 1, ...body });
const specific = (status: string) => status === "outside" ? problem("OUTSIDE_TERM") : status === "too-many" ? problem("TOO_MANY_SESSIONS")
  : status === "not-empty" ? problem("TERM_NOT_EMPTY") : failure(status);

/** `path` är delarna efter /planning: [], ["terms", id], ["sessions"], ["sessions", id], ["sessions", id, "race" | "tasks"], ["sessions", id, "tasks", id]. */
export async function clubPlanningRoute(db: Database, request: Request, clubId: string, path: readonly string[],
  environment: ClubEnvironment = process.env): Promise<Response> {
  if (!UUID_PATTERN.test(clubId) || path.some(part => part.length > 40)) return failure("not-found");
  const [area, id, sub, subId, ...rest] = path;
  if (rest.length > 0 || (id !== undefined && !UUID_PATTERN.test(id)) || (subId !== undefined && !UUID_PATTERN.test(subId))) return failure("not-found");
  if (request.method === "GET") {
    if (area !== undefined) return failure("not-found");
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    const termId = new URL(request.url).searchParams.get("term");
    return guarded(async () => {
      const result = await readClubPlan(db, { ...input.proof, clubId, termId: termId || null });
      return result.status === "ok" ? privateJson(result.response) : failure(result.status);
    });
  }
  const noBody = request.method === "DELETE" || (sub === "race" && request.method === "POST");
  const input = await mutation(request, environment, noBody ? "none" : "json");
  if ("response" in input) return input.response;
  const proof = { ...input.proof, clubId };
  return guarded(async () => {
    const method = request.method;
    if (area === undefined && method === "POST") {
      const result = await createClubTerm(db, { ...proof, request: input.body });
      return result.status === "ok" ? ok({ termId: result.termId }) : failure(result.status);
    }
    if (area === "terms" && id && sub === undefined && (method === "PUT" || method === "DELETE")) {
      const result = await changeClubTerm(db, { ...proof, termId: id, request: input.body, remove: method === "DELETE" });
      return result.status === "ok" ? ok() : specific(result.status);
    }
    if (area === "sessions" && id === undefined && method === "POST") {
      const result = await createPlanSessions(db, { ...proof, request: input.body });
      return result.status === "ok" ? ok({ sessionIds: result.sessionIds }) : specific(result.status);
    }
    if (area === "sessions" && id && sub === undefined && method === "PUT") {
      const result = await updatePlanSession(db, { ...proof, sessionId: id, request: input.body });
      return result.status === "ok" ? ok({ version: result.version }) : specific(result.status);
    }
    if (area === "sessions" && id && sub === undefined && method === "DELETE") {
      const result = await removePlanSession(db, { ...proof, sessionId: id });
      return result.status === "ok" ? ok() : failure(result.status);
    }
    if (area === "sessions" && id && sub === "race" && subId === undefined && method === "POST") {
      const result = await createPlannedRace(db, { ...proof, sessionId: id });
      return result.status === "ok" ? ok({ raceId: result.raceId, replayed: result.replayed }) : failure(result.status);
    }
    if (area === "sessions" && id && sub === "tasks" && subId === undefined && method === "POST") {
      const result = await createPlanTask(db, { ...proof, sessionId: id, request: input.body }, new Date(), planTaskMailer(environment, request));
      return result.status === "ok" ? ok({ taskId: result.taskId, mailed: result.mailed }) : failure(result.status);
    }
    if (area === "sessions" && id && sub === "tasks" && subId && method === "DELETE") {
      const result = await removePlanTask(db, { ...proof, sessionId: id, taskId: subId });
      return result.status === "ok" ? ok() : failure(result.status);
    }
    return failure("not-found");
  });
}

/** Mina uppgifter: GET listan, PUT /[taskId] klar eller inte. */
export async function myPlanTasksRoute(db: Database, request: Request, taskId: string | undefined, environment: ClubEnvironment = process.env)
  : Promise<Response> {
  if (request.method === "GET" && taskId === undefined) {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await listMyPlanTasks(db, input.proof);
      return result.status === "ok" ? privateJson(result.response) : failure(result.status);
    });
  }
  if (request.method !== "PUT" || !taskId || !UUID_PATTERN.test(taskId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await setPlanTaskDone(db, { ...input.proof, taskId, request: input.body });
    return result.status === "ok" ? ok() : failure(result.status);
  });
}
