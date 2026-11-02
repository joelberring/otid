/**
 * Serverfel som blir 500 (översynen 2026-11-02): loggas med åtgärd, felkod och stack men utan personuppgifter.
 * PostgreSQL:s `detail` (som kan innehålla brickor, namn och nycklar) loggas aldrig. Meddelandet tvättas: citerade värden,
 * värden i parentes efter `=` och långa sifferföljder (bricknummer, personnummer) byts mot `…`.
 */
export interface ServerErrorSummary {
  readonly area: string;
  readonly action: string;
  readonly name: string;
  /** SQLSTATE från PostgreSQL eller Node:s felkod (ECONNREFUSED …). */
  readonly code?: string;
  readonly constraint?: string;
  readonly table?: string;
  readonly message: string;
  readonly stack?: string;
}

const MAX_MESSAGE = 300;
const MAX_FRAMES = 12;

/** Tar bort värden som kan vara personuppgifter ur ett felmeddelande. */
export function redactErrorMessage(message: string): string {
  return message
    .replace(/"[^"]*"/g, (match) => /^"[a-z_][a-z0-9_]*"$/.test(match) ? match : "\"…\"")
    .replace(/'[^']*'/g, "'…'")
    .replace(/=\([^)]*\)/g, "=(…)")
    .replace(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, "…@…")
    .replace(/\d{5,}/g, "…")
    .slice(0, MAX_MESSAGE);
}

function stackFrames(stack: unknown): string | undefined {
  if (typeof stack !== "string") return undefined;
  const frames = stack.split("\n").filter((line) => /^\s+at /.test(line)).slice(0, MAX_FRAMES);
  return frames.length > 0 ? frames.map((line) => line.trim()).join("\n") : undefined;
}

/** Sammanfattning av felet (och dess orsak, högst fyra led) utan personuppgifter. */
export function summarizeServerError(area: string, action: string, error: unknown): ServerErrorSummary {
  let current: unknown = error;
  let code: string | undefined;
  let constraint: string | undefined;
  let table: string | undefined;
  for (let depth = 0; current && depth < 4; depth += 1, current = (current as { cause?: unknown }).cause) {
    const candidate = current as { code?: unknown; constraint?: unknown; table?: unknown };
    if (code === undefined && typeof candidate.code === "string") code = candidate.code;
    if (constraint === undefined && typeof candidate.constraint === "string") constraint = candidate.constraint;
    if (table === undefined && typeof candidate.table === "string") table = candidate.table;
  }
  const top = error instanceof Error ? error : undefined;
  const stack = stackFrames(top?.stack);
  return { area, action, name: top?.name ?? typeof error, ...(code ? { code } : {}), ...(constraint ? { constraint } : {}),
    ...(table ? { table } : {}), message: redactErrorMessage(top?.message ?? String(error)), ...(stack ? { stack } : {}) };
}

/** Skriver felet till serverns logg (stderr) som en rad JSON som går att söka i. */
export function logServerError(area: string, action: string, error: unknown): void {
  console.error(`O-Tid serverfel ${JSON.stringify(summarizeServerError(area, action, error))}`);
}

/**
 * Fel som betyder att databasen inte går att nå just nu (anslutningen, för många anslutningar, servern stängs). Svaret
 * blir 503 så att avläsningen väntar och skickar om i stället för att hålla avläsningen åt sidan.
 */
export function isDatabaseUnavailable(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 4; current = (current as { cause?: unknown }).cause, depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code !== "string") continue;
    if (["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "57P01", "57P02", "57P03", "53300"].includes(code) ||
      code.startsWith("08")) return true;
  }
  const message = error instanceof Error ? error.message : "";
  return /timeout exceeded when trying to connect|Connection terminated/i.test(message);
}
