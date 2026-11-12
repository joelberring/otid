import { isLanguage, LANGUAGE_COOKIE } from "../../lib/language";
import { isSafeReturnPath } from "../../lib/safe-return";

/**
 * Idéerna 2026-11-08 (engelska): byt språk. `till` (sv eller en) sparas i kakan `otid-lang` i ett år och besökaren skickas
 * tillbaka till sidan i `tillbaka` (bara en sökväg på samma webbplats).
 */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const language = url.searchParams.get("till");
  const back = url.searchParams.get("tillbaka") ?? "/";
  const target = isSafeReturnPath(back) ? back : "/";
  const secure = url.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const response = new Response(null, { status: 303, headers: { location: target, "cache-control": "no-store" } });
  if (isLanguage(language)) {
    response.headers.append("set-cookie", [`${LANGUAGE_COOKIE}=${language}`, "Path=/", "Max-Age=31536000", "SameSite=Lax", ...(secure ? ["Secure"] : [])].join("; "));
  }
  return response;
}
