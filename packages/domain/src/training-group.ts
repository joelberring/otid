/**
 * Steg 68 (ADR-0182): träningsgruppernas regler utan I/O – gruppens kod, namn som de får visas publikt (beslut 7),
 * upprepningens datum (beslut 3), kartavtalets varningar (beslut 4), samma deltagare mellan tillfällena (beslut 5) och
 * säsongens närvaro och poäng (beslut 6).
 */
export type GroupNameDisplay = "FIRST" | "FULL" | "NONE";
export type GroupPointsMode = "NONE" | "ATTENDANCE" | "PLACEMENT";

/** Gruppens kod i länken (/g/<kod>): 3–40 tecken a–z, 0–9 och bindestreck, inte först eller sist. */
export const GROUP_CODE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

/** Ett förslag på kod ur gruppens namn: "Ungdom OK ÄÖ" → "ungdom-ok-ao". */
export function suggestGroupCode(name: string): string {
  const slug = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
  if (slug.length >= 3) return slug;
  return slug ? `${slug}-grupp` : "grupp";
}

/** Det som visas i stället för namnet när gruppen visar inga namn. */
export const HIDDEN_PERSON_NAME = "Deltagare";

/** För- och efternamn som de får visas publikt. Förnamn: bara förnamnet (efternamnet tomt). Inga namn: "Deltagare". */
export function shownPersonName(mode: GroupNameDisplay, givenName: string, familyName: string): { givenName: string; familyName: string } {
  if (mode === "FULL") return { givenName, familyName };
  if (mode === "NONE") return { givenName: HIDDEN_PERSON_NAME, familyName: "" };
  return { givenName: givenName.trim() || HIDDEN_PERSON_NAME, familyName: "" };
}

/**
 * Ett helt namn i en rad ("Anna Svensson"), när för- och efternamn inte finns var för sig (den publicerade startlistan,
 * GPS-rutterna). Förnamn: första ordet, aldrig mer än det.
 */
export function shownDisplayName(mode: GroupNameDisplay, displayName: string): string {
  if (mode === "FULL") return displayName;
  if (mode === "NONE") return HIDDEN_PERSON_NAME;
  return displayName.trim().split(/\s+/)[0] || HIDDEN_PERSON_NAME;
}

/** Nycklar som identifierar en person utanför O-Tid och inte visas när gruppen döljer namnen. */
const IDENTIFYING_KEYS = new Set(["personEventorId"]);

/**
 * Namnen i ett publikt svar som gruppen tillåter (beslut 7). Går igenom hela värdet: ett objekt med `givenName` och
 * `familyName` får dem enligt inställningen (och `displayName` byggs om), ett objekt med bara `displayName` får det
 * förkortat, och Eventors person-id tas bort. `name`-fält rörs inte (de är klasser, banor och lag); anroparen förkortar
 * personnamn i sådana fält själv. Fullt namn ger värdet oförändrat.
 */
export function maskPublicNames<T>(value: T, mode: GroupNameDisplay): T {
  if (mode === "FULL") return value;
  const walk = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(walk);
    if (item === null || typeof item !== "object") return item;
    const record = item as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(record)) {
      if (IDENTIFYING_KEYS.has(key)) continue;
      out[key] = walk(field);
    }
    const hasParts = typeof record.givenName === "string" && typeof record.familyName === "string";
    if (hasParts) {
      const shown = shownPersonName(mode, record.givenName as string, record.familyName as string);
      out.givenName = shown.givenName;
      out.familyName = shown.familyName;
      if (typeof record.displayName === "string") out.displayName = [shown.givenName, shown.familyName].filter(Boolean).join(" ");
    } else if (typeof record.displayName === "string") {
      out.displayName = shownDisplayName(mode, record.displayName);
    }
    return out;
  };
  return walk(value) as T;
}

/** ISO-veckodag (1 = måndag … 7 = söndag) för ett datum ÅÅÅÅ-MM-DD. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export const MAX_REPETITION_SESSIONS = 60;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Upprepningens datum: varje `weekday` (ISO) från och med `firstDate` till och med `lastDate`. Högst 60 tillfällen och högst
 * ett drygt år; annars undefined (för långt eller ogiltigt).
 */
export function repetitionDates(input: { weekday: number; firstDate: string; lastDate: string }): string[] | undefined {
  if (!DATE.test(input.firstDate) || !DATE.test(input.lastDate) || !Number.isInteger(input.weekday) || input.weekday < 1 || input.weekday > 7) {
    return undefined;
  }
  const first = Date.parse(`${input.firstDate}T12:00:00Z`), last = Date.parse(`${input.lastDate}T12:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first || last - first > 400 * 86_400_000) return undefined;
  const dates: string[] = [];
  const offset = (input.weekday - isoWeekday(input.firstDate) + 7) % 7;
  for (let at = first + offset * 86_400_000; at <= last; at += 7 * 86_400_000) {
    dates.push(new Date(at).toISOString().slice(0, 10));
    if (dates.length > MAX_REPETITION_SESSIONS) return undefined;
  }
  return dates;
}

export interface MapAgreementFacts {
  ownership: "CLUB" | "EXTERNAL";
  validUntil: string | null;
  trainingOnly: boolean;
  feePerPrint: boolean;
  noPublicDisplay: boolean;
}

/**
 * Det O-Tid säger till om innan kartan används (beslut 4):
 * - EXPIRED: avtalet gällde till ett datum före tävlingen,
 * - NO_PUBLIC_DISPLAY: avtalet tillåter inte publik visning (gäller bara när kartan ska visas publikt),
 * - TRAINING_ONLY: bara träning, men tävlingen är inte en träning,
 * - FEE_PER_PRINT: avgift per utskrift (bara upplysning).
 * Klubbens egen karta har inga varningar om giltighetstid och villkor saknas.
 */
export type MapAgreementIssue = "EXPIRED" | "NO_PUBLIC_DISPLAY" | "TRAINING_ONLY" | "FEE_PER_PRINT";

export function mapAgreementIssues(agreement: MapAgreementFacts, use: { date: string; publicUse?: boolean; raceType?: string }): MapAgreementIssue[] {
  const issues: MapAgreementIssue[] = [];
  if (agreement.validUntil !== null && agreement.validUntil < use.date) issues.push("EXPIRED");
  if (use.publicUse && agreement.noPublicDisplay) issues.push("NO_PUBLIC_DISPLAY");
  if (agreement.trainingOnly && use.raceType !== undefined && use.raceType !== "TRAINING") issues.push("TRAINING_ONLY");
  if (agreement.feePerPrint) issues.push("FEE_PER_PRINT");
  return issues;
}

/**
 * Kartan får inte visas publikt (vägvalskartan, GPS-rutterna, kartbilden) när avtalet gått ut eller inte tillåter publik
 * visning, om inte admin medvetet valt att visa den ändå (spärr med möjlighet att gå vidare).
 */
export function mapPublicUseBlocked(agreement: MapAgreementFacts | undefined, date: string, acknowledged: boolean): boolean {
  if (!agreement || acknowledged) return false;
  return mapAgreementIssues(agreement, { date, publicUse: true }).some(issue => issue === "EXPIRED" || issue === "NO_PUBLIC_DISPLAY");
}

const normalized = (text: string) => text.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("sv-SE");

/**
 * Samma deltagare mellan gruppens tillfällen (beslut 5): Eventors person-id när det finns, annars för- och efternamn
 * (utan skillnad på stora och små bokstäver och mellanslag). Brickan räknas inte – den kan vara hyrd eller lånad.
 */
export function groupParticipantKey(entry: { givenName: string; familyName: string; eventorPersonId?: string | null }): string {
  if (entry.eventorPersonId) return `eventor:${entry.eventorPersonId}`;
  return `namn:${normalized(entry.givenName)}|${normalized(entry.familyName)}`;
}

export interface SeasonSessionResult {
  key: string;
  givenName: string;
  familyName: string;
  className: string;
  status: string;
  position?: number | undefined;
}

export interface SeasonRow {
  key: string;
  givenName: string;
  familyName: string;
  attended: number;
  points: number;
  /** Tillfällena (tävlings-id) deltagaren var med på, i datumordning. */
  raceIds: string[];
}

/** Placeringspoäng: 10 för första plats, 9 för andra … 1 från tionde; godkänd utan placering 1; annars 0. */
export function placementPoints(result: { status: string; position?: number | undefined }): number {
  if (result.status !== "OK") return 0;
  if (result.position === undefined) return 1;
  return Math.max(1, 11 - result.position);
}

/**
 * Säsongen (beslut 6): närvaro per deltagare (ett tillfälle där deltagaren har ett resultat som inte är ej start) och
 * en valfri enkel poängserie – en poäng per träning, eller placeringspoäng. Senaste namnet gäller (det som stod sist).
 */
export function seasonTable(sessions: readonly { raceId: string; raceDate: string; results: readonly SeasonSessionResult[] }[],
  mode: GroupPointsMode): SeasonRow[] {
  const rows = new Map<string, SeasonRow>();
  const ordered = [...sessions].sort((a, b) => a.raceDate.localeCompare(b.raceDate) || a.raceId.localeCompare(b.raceId));
  for (const session of ordered) {
    const seen = new Map<string, number>();
    for (const result of session.results) {
      if (result.status === "DNS") continue;
      const points = mode === "PLACEMENT" ? placementPoints(result) : mode === "ATTENDANCE" ? 1 : 0;
      const row = rows.get(result.key) ?? { key: result.key, givenName: result.givenName, familyName: result.familyName, attended: 0,
        points: 0, raceIds: [] };
      row.givenName = result.givenName; row.familyName = result.familyName;
      // Två starter samma kväll (två klasser) räknas som en närvaro; poängen är den bästa.
      const previous = seen.get(result.key);
      if (previous === undefined) {
        row.attended += 1; row.points += points; row.raceIds.push(session.raceId);
      } else if (points > previous) row.points += points - previous;
      seen.set(result.key, Math.max(previous ?? 0, points));
      rows.set(result.key, row);
    }
  }
  return [...rows.values()].sort((a, b) => (mode === "NONE" ? 0 : b.points - a.points) || b.attended - a.attended ||
    a.givenName.localeCompare(b.givenName, "sv") || a.familyName.localeCompare(b.familyName, "sv") || a.key.localeCompare(b.key));
}
