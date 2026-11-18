import { cardTypeFromSi8PlusNumber } from "./card-types";
import { CardDecodeError, type SiCardData, type SiPunchRecord, type SiStationRecord } from "./decode";
import type { SiTime } from "./time";

/**
 * SPORTident Reader BT (avläsningsstation över Bluetooth Low Energy). Protokollet är inte stationens vanliga
 * seriella (STX … ETX) utan SPORTidents eget för läsaren, uttytt ur en Bluetooth-logg från SPORTident Config (iOS)
 * och kontrollerat mot riktiga brickor (SI9, SI11). Vi skickar bara det appen skickar.
 *
 * Meddelande: typ (1 byte), kommando (1), längd (2, little-endian), innehåll. Allt är little-endian.
 * - `01 11`: bricka i (sista byten 1) eller ur (0): bricknummer (4) och flagga.
 * - `03 11`: brickans innehåll (se `decodeReaderBtCard`).
 * - `01 a1`: en bit av ett längre meddelande: index (1, från 1); den första biten har även hela längden (4).
 */

/** Tjänster och egenskaper (GATT). */
export const READER_BT_SERVICE_MAIN = "bd510001-6aec-4628-a146-f3e95bc49e62";
export const READER_BT_COMMAND = "bd510003-6aec-4628-a146-f3e95bc49e62";
export const READER_BT_SERVICE_CARDS = "bd510011-6aec-4628-a146-f3e95bc49e62";
export const READER_BT_EVENTS = "bd510012-6aec-4628-a146-f3e95bc49e62";
export const READER_BT_CARD_DATA = "bd510013-6aec-4628-a146-f3e95bc49e62";
/** Stationens namn i Bluetooth: "Reader BT 1000298" (serienumret sist). */
export const READER_BT_NAME_PREFIX = "Reader BT";

/** Startar avläsningsläget (till `READER_BT_COMMAND`). */
export const READER_BT_START_READOUT = Uint8Array.of(0x0f, 0x01, 0x01, 0x00, 0x01);
/** Kvitterar en avläst bricka (till `READER_BT_CARD_DATA`), efter varje brickas innehåll. */
export const READER_BT_ACK_CARD = Uint8Array.of(0x10, 0x11, 0x01, 0x00, 0x01);

const HEADER = 4;
const CARD_HEAD = 7;
const RECORD = 8;
/** Ett meddelande är aldrig i närheten av detta (192 stämplingar ≈ 1,7 kB); skydd mot trasig längd. */
const MAX_MESSAGE = 8192;
const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

const isCardMessage = (bytes: Uint8Array) => bytes[0] === 0x03 && bytes[1] === 0x11;
const isFragment = (bytes: Uint8Array) => bytes[0] === 0x01 && bytes[1] === 0xa1;
const u16 = (bytes: Uint8Array, at: number) => bytes[at]! | (bytes[at + 1]! << 8);
const u32 = (bytes: Uint8Array, at: number) => (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;

/** Stationsnamnets serienummer ("Reader BT 1000298" → 1000298). */
export function readerBtSerial(name: string | undefined): number | undefined {
  const match = /(\d+)\s*$/.exec(name ?? "");
  return match ? Number(match[1]) : undefined;
}

/** `01 11`: bricka i eller ur. */
export function readerBtCardEvent(bytes: Uint8Array): { cardNumber: number; inserted: boolean } | undefined {
  if (bytes.length < 9 || bytes[0] !== 0x01 || bytes[1] !== 0x11) return undefined;
  return { cardNumber: u32(bytes, HEADER), inserted: bytes[8] === 1 };
}

/**
 * Sätter ihop brickans innehåll av notifieringarna från `READER_BT_CARD_DATA`. `push` ger det hela meddelandet
 * (`03 11 …`) när det är komplett, annars undefined. Råa notifieringar som hör till meddelandet finns i `frames`.
 */
export class ReaderBtAssembler {
  #parts: Uint8Array[] = [];
  #frames: Uint8Array[] = [];
  #expected = 0;
  #next = 1;

  /** Notifieringarna (som de kom) som bildade det senast kompletta meddelandet. */
  frames: readonly Uint8Array[] = [];

  push(notification: Uint8Array): Uint8Array | undefined {
    const bytes = notification.slice();
    if (isCardMessage(bytes)) {
      this.#reset();
      const length = HEADER + u16(bytes, 2);
      if (bytes.length < length) throw new CardDecodeError(`Brickans meddelande är avkortat: ${bytes.length} av ${length} byte`);
      this.frames = [bytes];
      return bytes.slice(0, length);
    }
    if (!isFragment(bytes) || bytes.length < HEADER + 1) return undefined;
    const length = HEADER + u16(bytes, 2);
    const index = bytes[4]!;
    // Protokollet har ingen kontrollsumma (BLE-länken har sin egen CRC); en avkortad bit fångas här och via längderna.
    if (bytes.length < length) { this.#reset(); throw new CardDecodeError(`Bit ${index} är avkortad: ${bytes.length} av ${length} byte`); }
    if (index === 1) {
      this.#reset();
      if (length < 9) throw new CardDecodeError("Första biten saknar längd");
      this.#expected = u32(bytes, 5);
      if (this.#expected > MAX_MESSAGE) throw new CardDecodeError(`Orimlig meddelandelängd ${this.#expected}`);
      this.#parts.push(bytes.slice(9, length));
    } else {
      if (index !== this.#next) {
        const expected = this.#next;
        this.#reset();
        throw new CardDecodeError(`Bit ${index} kom när bit ${expected} väntades`);
      }
      this.#parts.push(bytes.slice(5, length));
    }
    this.#frames.push(bytes);
    this.#next = index + 1;
    const joined = concat(this.#parts);
    const expected = this.#expected;
    if (joined.length < expected) return undefined;
    this.frames = this.#frames;
    this.#reset();
    return joined.slice(0, expected);
  }

  #reset(): void {
    this.#parts = []; this.#frames = []; this.#expected = 0; this.#next = 1;
  }
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/** Bricknumret i ett komplett `03 11`-meddelande (även när bricktypen inte stöds). */
export function readerBtCardNumber(message: Uint8Array): number | undefined {
  return isCardMessage(message) && message.length >= HEADER + 4 ? u32(message, HEADER) : undefined;
}

/** Millisekunder sedan veckans början (söndag 00:00) → brickans tid. Utanför veckan: ingen tid. */
function weekTime(ms: number): SiTime | undefined {
  if (ms >= MS_PER_WEEK) return undefined;
  const ofDay = ms % MS_PER_DAY;
  return { secondsIn12h: Math.floor(ofDay / 1000) % 43_200, pm: ofDay >= MS_PER_DAY / 2, dayOfWeek: Math.floor(ms / MS_PER_DAY) };
}

const STATION_KINDS = { 1: "clear", 2: "check", 3: "start", 5: "finish" } as const;
const PUNCH = 7;
/** Typ 6 har samma tid och kod som målstämplingen (sett på SI11); den används inte. */
const IGNORED = new Set([6]);

/**
 * `03 11`: bricknummer (4), bricktyp (1), antal poster (2), poster (8 byte: flagga, typ, kod (2), tid (4) som
 * millisekunder sedan söndag 00:00), därefter ägaruppgifter (används inte). Typ: 1 nollställning, 2 check, 3 start,
 * 5 mål, 7 stämpling. Allt okänt (flagga, posttyp, två mål) ger `CardDecodeError` hellre än en gissning.
 */
export function decodeReaderBtCard(message: Uint8Array): SiCardData {
  if (!isCardMessage(message)) throw new CardDecodeError("Inte brickans innehåll från Reader BT");
  const length = u16(message, 2);
  const body = message.subarray(HEADER, HEADER + length);
  if (body.length < length || length < CARD_HEAD) throw new CardDecodeError("Brickans meddelande är för kort");
  const cardNumber = u32(body, 0);
  const cardType = cardTypeFromSi8PlusNumber(cardNumber);
  if (!cardType) throw new CardDecodeError(`Bricktypen stöds inte över Bluetooth: ${cardNumber}`);
  const count = u16(body, 5);
  if (body.length < CARD_HEAD + count * RECORD) throw new CardDecodeError(`${count} poster ryms inte i ${body.length} byte`);
  const stations: Partial<Record<"clear" | "check" | "start" | "finish", SiStationRecord>> = {};
  const punches: SiPunchRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = CARD_HEAD + index * RECORD;
    const flag = body[at]!;
    const kind = body[at + 1]!;
    const code = u16(body, at + 2);
    const time = weekTime(u32(body, at + 4));
    if (flag !== 0) throw new CardDecodeError(`Post ${index + 1} har en okänd flagga 0x${flag.toString(16)}`);
    if (kind === PUNCH) { punches.push(time ? { code, time } : { code }); continue; }
    if (IGNORED.has(kind)) continue;
    const name = STATION_KINDS[kind as keyof typeof STATION_KINDS];
    if (!name) throw new CardDecodeError(`Post ${index + 1} har en okänd typ ${kind}`);
    if (stations[name]) throw new CardDecodeError(`Brickan har två poster av typen ${name}`);
    if (time) stations[name] = { time, code };
  }
  return { cardType, cardNumber, ...stations, punches };
}

/** Sparade råramar från Reader BT (i stället för stationens seriella ramar)? */
export function isReaderBtFrames(frames: readonly Uint8Array[]): boolean {
  const first = frames[0];
  return first !== undefined && (isCardMessage(first) || isFragment(first));
}

/** Högsta längd på en sparad råram (kontraktet för avläsningar). */
const MAX_STORED_FRAME = 300;

/**
 * Notifieringarna som de sparas: en notifiering längre än en sparad råram (större MTU) delas. `decodeReaderBtFrames`
 * läser ramarna som en sammanhängande ström, så delningen ändrar ingenting.
 */
export function readerBtStorageFrames(notifications: readonly Uint8Array[]): Uint8Array[] {
  return notifications.flatMap((bytes) => Array.from({ length: Math.ceil(bytes.length / MAX_STORED_FRAME) },
    (_, index) => bytes.slice(index * MAX_STORED_FRAME, (index + 1) * MAX_STORED_FRAME)));
}

/** Steg 36 för Reader BT: läser om brickan ur de sparade notifieringarna (som en ström av meddelanden). */
export function decodeReaderBtFrames(frames: readonly Uint8Array[]): SiCardData {
  const stream = concat(frames);
  const assembler = new ReaderBtAssembler();
  let message: Uint8Array | undefined;
  let at = 0;
  while (at + HEADER <= stream.length) {
    const end = at + HEADER + u16(stream, at + 2);
    if (end > stream.length) throw new CardDecodeError("Råramarna slutar mitt i ett meddelande");
    const complete = assembler.push(stream.subarray(at, end));
    // En sparad avläsning är exakt en bricka; ett andra meddelande (dubblett eller annan bricka) är fel i råramarna.
    if (complete && message) throw new CardDecodeError("Råramarna har mer än ett meddelande från brickan");
    message = complete ?? message;
    at = end;
  }
  if (at !== stream.length) throw new CardDecodeError("Råramarna slutar mitt i ett meddelande");
  if (!message) throw new CardDecodeError("Brickans innehåll är inte komplett i råramarna");
  return decodeReaderBtCard(message);
}
