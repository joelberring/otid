import { parseRaceClock } from "@o-tid/domain";
import { fail } from "./errors";

/**
 * ROC-protokollet (Radio Online Control, även OResults): ett svar är vanlig text med en stämpling per rad,
 * fälten åtskilda med semikolon: stämplings-id; kontrollkod; bricka; tid "YYYY-MM-DD HH:MM:SS" i lokal tid
 * utan zon. Läsningen är tolerant: BOM, CR/CRLF, tomma rader och mellanslag godtas, oläsbara rader hoppas
 * över och räknas, upprepade rader räknas som dubbletter. Den lokala tiden tolkas i tävlingens tidszon.
 */

export interface RocPunch {
  /** Stämplingens id hos tjänsten (ökar normalt, men ordningen litar vi inte på). */
  readonly punchId: number;
  readonly controlCode: number;
  /** Bricknummer utan inledande nollor. */
  readonly cardNumber: string;
  /** Tiden som tjänsten skickade den: "YYYY-MM-DD HH:MM:SS", lokal tid. */
  readonly localTime: string;
  /** Samma tid som ögonblick (ISO 8601, UTC), tolkad i tävlingens tidszon. */
  readonly punchedAt: string;
  /** Raden som den kom, utan radslut. Sparas oförändrad. */
  readonly rawLine: string;
}

export interface RocPunchList {
  readonly punches: readonly RocPunch[];
  /** Rader som inte gick att läsa och hoppades över. */
  readonly malformedLines: number;
  /** Rader med ett id eller en stämpling (bricka, kontroll, tid) som redan fanns tidigare i svaret. */
  readonly duplicateLines: number;
  /** Högsta stämplings-id bland de lästa raderna, eller null utan stämplingar. */
  readonly highestPunchId: number | null;
}

const ID = /^\d{1,15}$/;
const CODE = /^\d{1,4}$/;
const CARD = /^\d{1,10}$/;
const TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:[.,]\d{1,6})?$/;
const MAX_CARD = 99_999_999;

/** Tidszonen måste vara en IANA-zon som Intl känner till. */
export function assertTimeZone(timeZone: string): void {
  try { new Intl.DateTimeFormat("sv-SE", { timeZone }).format(0); } catch { fail("INVALID_INPUT"); }
}

/** "YYYY-MM-DD HH:MM:SS" (lokal tid) som ögonblick i tidszonen, eller null om tiden inte finns. */
export function rocLocalTimeToInstant(value: string, timeZone: string): string | null {
  const match = TIME.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  // Ett datum som inte finns (30 februari) ska inte rulla över till nästa månad.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || year < 2000) return null;
  // Vid övergången till sommartid finns klockslaget inte (null); vid vintertid väljs det första.
  return parseRaceClock(`${match[1]}-${match[2]}-${match[3]}`, `${match[4]}:${match[5]}:${match[6]}`, timeZone);
}

/** Längsta rad som sparas (databasens gräns). En rimlig rad är ett 40-tal tecken. */
const MAX_LINE = 1_000;

function readLine(line: string, timeZone: string): RocPunch | undefined {
  if (line.length > MAX_LINE) return undefined;
  const fields = line.split(";").map(field => field.trim());
  // Fler fält än fyra godtas (en senare version kan lägga till), färre är en trasig rad.
  if (fields.length < 4) return undefined;
  const [id, code, card, time] = fields as [string, string, string, string];
  if (!ID.test(id) || !CODE.test(code) || !CARD.test(card)) return undefined;
  const punchId = Number(id);
  const controlCode = Number(code);
  const cardValue = Number(card);
  if (!Number.isSafeInteger(punchId) || punchId < 1 || controlCode < 1 || cardValue < 1 || cardValue > MAX_CARD) return undefined;
  const punchedAt = rocLocalTimeToInstant(time, timeZone);
  if (!punchedAt) return undefined;
  const localTime = time.replace("T", " ").slice(0, 19);
  return { punchId, controlCode, cardNumber: String(cardValue), localTime, punchedAt, rawLine: line };
}

/** Läser ett svar från ROC eller OResults. Kastar bara för ogiltig tidszon. */
export function parseRocPunches(body: string, timeZone: string): RocPunchList {
  assertTimeZone(timeZone);
  const text = body.startsWith("\uFEFF") ? body.slice(1) : body;
  const punches: RocPunch[] = [];
  const ids = new Set<number>();
  const contents = new Set<string>();
  let malformedLines = 0;
  let duplicateLines = 0;
  let highestPunchId: number | null = null;
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if (raw.trim() === "") continue;
    const punch = readLine(raw, timeZone);
    if (!punch) { malformedLines += 1; continue; }
    const content = `${punch.cardNumber};${punch.controlCode};${punch.punchedAt}`;
    if (ids.has(punch.punchId) || contents.has(content)) {
      duplicateLines += 1;
      highestPunchId = Math.max(highestPunchId ?? 0, punch.punchId);
      continue;
    }
    ids.add(punch.punchId);
    contents.add(content);
    highestPunchId = Math.max(highestPunchId ?? 0, punch.punchId);
    punches.push(punch);
  }
  return { punches, malformedLines, duplicateLines, highestPunchId };
}
