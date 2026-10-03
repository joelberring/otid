export const RESULT_WRITE_ADMIN_MAX_BODY_BYTES = 4 * 1024;
const SAFE_COOKIE_VALUE = /^[A-Za-z0-9._~-]+$/;

export const privateResultWriteAdminHeaders = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff"
} as const;

export interface ResultWriteAdminSecurityPolicy<CookieNames> {
  publicOrigin: string;
  cookieNames: CookieNames;
  secureCookies: boolean;
}

export interface ResultWriteAdminSessionProof {
  sessionToken: string | null;
  csrfCookie: string | null;
  csrfHeader: string | null;
}

export class ResultWriteAdminRequestError extends Error {}
export class ResultWriteAdminConfigurationError extends Error {}

interface CookieNames { session: string; csrf: string }

interface ResultWriteAdminSecurityConfig<ProductionNames extends CookieNames, LoopbackNames extends CookieNames> {
  productionCookieNames: ProductionNames;
  loopbackCookieNames: LoopbackNames;
  isLoopbackHostname(hostname: string): boolean;
  errorResponseSchema: { parse(value: unknown): unknown };
  configurationLabel: string;
}

function parseConfiguredOrigin(value: string, label: string): URL {
  let url: URL;
  try { url = new URL(value); } catch {
    throw new ResultWriteAdminConfigurationError(`O_TID_PUBLIC_ORIGIN är inte en giltig URL-origin (${label})`);
  }
  if (value !== url.origin || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new ResultWriteAdminConfigurationError("O_TID_PUBLIC_ORIGIN måste vara en exakt canonical origin");
  }
  return url;
}

function readUniqueCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  let found: string | undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    if (found !== undefined) return null;
    const value = part.slice(separator + 1).trim();
    if (!value || !SAFE_COOKIE_VALUE.test(value)) return null;
    found = value;
  }
  return found ?? null;
}

function safeCookieValue(value: string): string {
  if (!SAFE_COOKIE_VALUE.test(value)) throw new ResultWriteAdminConfigurationError("Ogiltigt cookie-värde");
  return value;
}

export function createResultWriteAdminSecurity<
  ProductionNames extends CookieNames,
  LoopbackNames extends CookieNames,
  ErrorCode extends string
>(
  config: ResultWriteAdminSecurityConfig<ProductionNames, LoopbackNames>
) {
  type Policy = ResultWriteAdminSecurityPolicy<ProductionNames | LoopbackNames>;

  function securityPolicy(
    environment: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">> = process.env
  ): Policy {
    const configuredOrigin = environment.O_TID_PUBLIC_ORIGIN;
    if (!configuredOrigin) throw new ResultWriteAdminConfigurationError("O_TID_PUBLIC_ORIGIN saknas");
    const url = parseConfiguredOrigin(configuredOrigin, config.configurationLabel);
    if (environment.NODE_ENV === "production") {
      if (url.protocol !== "https:") throw new ResultWriteAdminConfigurationError("Produktion kräver HTTPS-origin");
      return { publicOrigin: url.origin, cookieNames: config.productionCookieNames, secureCookies: true };
    }
    if (url.protocol !== "http:" || !config.isLoopbackHostname(url.hostname)) {
      throw new ResultWriteAdminConfigurationError("Utvecklingspolicy tillåter endast explicit HTTP-loopback-origin");
    }
    return { publicOrigin: url.origin, cookieNames: config.loopbackCookieNames, secureCookies: false };
  }

  function hasExpectedOrigin(request: Request, policy: Policy): boolean {
    return request.headers.get("origin") === policy.publicOrigin;
  }

  function sessionProof(request: Request, policy: Policy, requireCsrf: boolean): ResultWriteAdminSessionProof {
    return {
      sessionToken: readUniqueCookie(request, policy.cookieNames.session),
      csrfCookie: requireCsrf ? readUniqueCookie(request, policy.cookieNames.csrf) : null,
      csrfHeader: requireCsrf ? request.headers.get("x-otid-csrf") : null
    };
  }

  async function readJson(request: Request): Promise<unknown> {
    if (request.headers.get("content-type") !== "application/json") {
      throw new ResultWriteAdminRequestError("Content-Type måste vara application/json");
    }
    const declaredLength = request.headers.get("content-length");
    if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) < 1 ||
        Number(declaredLength) > RESULT_WRITE_ADMIN_MAX_BODY_BYTES)) {
      throw new ResultWriteAdminRequestError("Ogiltig bodylängd");
    }
    if (!request.body) throw new ResultWriteAdminRequestError("Body saknas");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > RESULT_WRITE_ADMIN_MAX_BODY_BYTES) throw new ResultWriteAdminRequestError("Bodyn är för stor");
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    }
    if (length === 0) throw new ResultWriteAdminRequestError("Body saknas");
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
    catch { throw new ResultWriteAdminRequestError("Ogiltig JSON"); }
  }

  async function hasNoBody(request: Request): Promise<boolean> {
    if (request.headers.get("content-type") !== null) return false;
    const contentLength = request.headers.get("content-length");
    if (contentLength !== null && contentLength !== "0") return false;
    if (request.body === null) return true;
    const reader = request.body.getReader();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return true;
        if (chunk.value.byteLength > 0) return false;
      }
    } finally { await reader.cancel(); }
  }

  function cookieHeader(
    name: string,
    value: string,
    policy: Policy,
    options: { httpOnly: boolean; expires: Date }
  ): string {
    const attributes = [
      `${name}=${safeCookieValue(value)}`,
      "Path=/",
      `Expires=${options.expires.toUTCString()}`,
      "SameSite=Strict"
    ];
    if (options.httpOnly) attributes.push("HttpOnly");
    if (policy.secureCookies) attributes.push("Secure");
    return attributes.join("; ");
  }

  function setCookies(
    response: Response,
    policy: Policy,
    values: { sessionToken: string; csrfToken: string; expiresAt: string }
  ): Response {
    const expires = new Date(values.expiresAt);
    if (!Number.isFinite(expires.getTime())) throw new ResultWriteAdminConfigurationError("Ogiltig sessionsexpiry");
    response.headers.append("set-cookie", cookieHeader(
      policy.cookieNames.session, values.sessionToken, policy, { httpOnly: true, expires }
    ));
    response.headers.append("set-cookie", cookieHeader(
      policy.cookieNames.csrf, values.csrfToken, policy, { httpOnly: false, expires }
    ));
    return response;
  }

  function clearCookies(response: Response, policy: Policy): Response {
    const expired = new Date(0);
    response.headers.append("set-cookie", `${cookieHeader(
      policy.cookieNames.session, "deleted", policy, { httpOnly: true, expires: expired }
    )}; Max-Age=0`);
    response.headers.append("set-cookie", `${cookieHeader(
      policy.cookieNames.csrf, "deleted", policy, { httpOnly: false, expires: expired }
    )}; Max-Age=0`);
    return response;
  }

  function json(body: unknown, status = 200): Response {
    return Response.json(body, { status, headers: privateResultWriteAdminHeaders });
  }

  function failure(status: 400 | 401 | 403 | 404 | 409 | 413 | 500, code: ErrorCode): Response {
    return json(config.errorResponseSchema.parse({ formatVersion: 1, error: code }), status);
  }

  return { securityPolicy, hasExpectedOrigin, sessionProof, readJson, hasNoBody,
    setCookies, clearCookies, json, failure };
}
