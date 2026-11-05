import { readMapLinkMapFile, readMapLinkView, replyViaMapLink, setVerdictViaMapLink } from "@o-tid/application";
import { mapLinkErrorResponseSchema, mapLinkViewSchema, type MapLinkErrorCode } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { publishCourseSettingEvent } from "./course-setting-events";
import { publicBusyResponse, publicLoad } from "./public-load";
import {
  SecurityConfigurationError, clientAddress, hasExpectedOrigin, privateHeaders, readJsonBody, securityPolicy
} from "./security-policy";
import { logServerError } from "./server-error-log";

/**
 * ADR-0214: kartritarens länk (`/kartfel/<nyckel>`). Nyckeln i adressen är behörigheten; inget konto och ingen session.
 *
 * - Läsningen (`/api/public/map-link/<nyckel>` och `…/map`) går till de publika instanserna (Caddy: `/api/public/*`) och
 *   får en plats i publikens kö. Svaren cachas aldrig delat (`private, no-store`; kartfilen `private, no-cache` med ETag).
 * - Skrivningarna (`/api/map-link/<nyckel>/notes/<id>/…`) går till tävlingens instans, så att banläggningens ström når
 *   öppna editorer direkt. Utan session binds skrivningen till nyckeln och samma ursprung: exakt Origin, JSON och huvudet
 *   `x-otid-map-link` (som en annan sajt inte kan skicka utan att webbläsaren frågar först).
 * - Ogiltig, avstängd, utgången och okänd länk ger samma svar (404 LINK_INVALID).
 */
export const MAP_LINK_WRITE_HEADER = "x-otid-map-link";
type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;

export const mapLinkServices = { view: readMapLinkView, mapFile: readMapLinkMapFile, reply: replyViaMapLink, verdict: setVerdictViaMapLink };
export type MapLinkServices = typeof mapLinkServices;

function failure(status: 400 | 403 | 404 | 409 | 429 | 500, error: MapLinkErrorCode): Response {
  return Response.json(mapLinkErrorResponseSchema.parse({ formatVersion: 1, error }), {
    status, headers: { ...privateHeaders, ...(status === 429 ? { "retry-after": "600" } : {}) } });
}
const linkFailure = (status: "invalid" | "rate-limited") => status === "invalid" ? failure(404, "LINK_INVALID") : failure(429, "RATE_LIMITED");

async function admitted(run: () => Promise<Response>): Promise<Response> {
  const slot = await publicLoad().admit();
  if (slot.kind === "busy") return publicBusyResponse(slot.retryAfterSeconds);
  try { return await run(); } finally { slot.release(); }
}

/** Kartfelen med länken (GET). */
export async function mapLinkViewRoute(db: Database, request: Request, token: string, services: MapLinkServices = mapLinkServices): Promise<Response> {
  return admitted(async () => {
    try {
      const result = await services.view(db, { token, clientKey: clientAddress(request) });
      if (result.status !== "ok") return linkFailure(result.status);
      return Response.json(mapLinkViewSchema.parse(result.response), { headers: privateHeaders });
    } catch (error) { logServerError("map-link", "view", error); return failure(500, "INTERNAL_ERROR"); }
  });
}

/** Kartfilen med länken (GET); samma fil igen (If-None-Match) ger 304 efter att länken prövats. */
export async function mapLinkMapRoute(db: Database, request: Request, token: string, services: MapLinkServices = mapLinkServices): Promise<Response> {
  return admitted(async () => {
    try {
      const tag = /^"([a-f0-9]{64})"$/.exec(request.headers.get("if-none-match")?.trim() ?? "")?.[1];
      const result = await services.mapFile(db, { token, clientKey: clientAddress(request), ifNoneMatch: tag });
      if (result.status === "invalid" || result.status === "rate-limited") return linkFailure(result.status);
      if (result.status === "not-found") return failure(404, "NOT_FOUND");
      const cache = { ...privateHeaders, "cache-control": "private, no-cache", etag: `"${result.sha256}"` };
      if (result.status === "not-modified") return new Response(null, { status: 304, headers: cache });
      const extension = result.format === "OCD" ? "ocd" : "omap";
      return new Response(new Uint8Array(result.file), { headers: { ...cache, "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="karta.${extension}"`, "content-length": String(result.file.byteLength) } });
    } catch (error) { logServerError("map-link", "map", error); return failure(500, "INTERNAL_ERROR"); }
  });
}

/** Skrivningen kommer från sidan själv: exakt Origin, JSON och kartritarens huvud. */
function sameOrigin(request: Request, environment: Environment): boolean | "configuration" {
  let policy;
  try { policy = securityPolicy(environment); } catch (error) { if (error instanceof SecurityConfigurationError) return "configuration"; throw error; }
  return hasExpectedOrigin(request, policy) && request.headers.get(MAP_LINK_WRITE_HEADER) === "1"
    && request.headers.get("sec-fetch-site") !== "cross-site";
}

/** Svar eller besked med länken (POST): `kind` säger vilket. Öppna editorer får beskedet i banläggningens ström. */
export async function mapLinkWriteRoute(db: Database, request: Request, token: string, noteId: string, kind: "reply" | "verdict",
  environment: Environment = process.env, services: MapLinkServices = mapLinkServices): Promise<Response> {
  const origin = sameOrigin(request, environment);
  if (origin === "configuration") return failure(500, "INTERNAL_ERROR");
  if (!origin) return failure(403, "FORBIDDEN");
  let body: unknown;
  try { body = await readJsonBody(request, 8 * 1024); } catch { return failure(400, "INVALID_REQUEST"); }
  try {
    const input = { token, clientKey: clientAddress(request), noteId, request: body };
    const result = kind === "reply" ? await services.reply(db, input) : await services.verdict(db, input);
    switch (result.status) {
      case "ok":
        publishCourseSettingEvent(result.raceId, { type: "notes", by: "map-link" });
        return new Response(null, { status: 204, headers: privateHeaders });
      case "invalid": case "rate-limited": return linkFailure(result.status);
      case "invalid-request": return failure(400, "INVALID_REQUEST");
      case "not-found": return failure(404, "NOT_FOUND");
      case "conflict": return failure(409, "INVALID_REQUEST");
    }
  } catch (error) { logServerError("map-link", kind, error); return failure(500, "INTERNAL_ERROR"); }
}
