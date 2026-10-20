import { BLOCK_SIZE } from "./constants";
import { CARD_LAYOUTS, cardImageBlocks, decodeCardNumber, expectedImageSize, type FieldLayout, type SiCardType } from "./card-types";
import { decodeControlCode, decodeSiTime, type SiTime } from "./time";

export interface SiStationRecord {
  readonly time: SiTime;
  /** Stationskoden som registrerades, om brickan sparar den. */
  readonly code?: number;
}

export interface SiPunchRecord {
  readonly code: number;
  /** Saknas för SI5-stämplingar 31–36, som bara sparar kod. */
  readonly time?: SiTime;
}

/** Brickans innehåll, avkodat men ännu inte omräknat till absoluta tider. */
export interface SiCardData {
  readonly cardType: SiCardType;
  readonly cardNumber: number;
  readonly start?: SiStationRecord;
  readonly finish?: SiStationRecord;
  readonly check?: SiStationRecord;
  readonly clear?: SiStationRecord;
  readonly punches: readonly SiPunchRecord[];
}

export class CardDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardDecodeError";
  }
}

/**
 * Avkodar en sammanfogad minnesbild (block i läsordning, utan blocknummer).
 */
export function decodeCard(cardType: SiCardType, image: Uint8Array): SiCardData {
  // SI5–SI9 läses alltid hela. SI6 och SI10/11/SIAC kan sakna sista blocken (brickan togs ur), vilket går bra så
  // länge stämplingarna som brickan säger att den har finns med (kontrolleras nedan).
  const expected = cardType === "SI6" || cardType === "SI10" || cardType === "SI11" || cardType === "SIAC"
    ? BLOCK_SIZE : expectedImageSize(cardType);
  if (image.length < expected) {
    throw new CardDecodeError(`För lite data för ${cardType}: ${image.length} av ${expected} byte`);
  }
  const layout = CARD_LAYOUTS[cardType];
  const at = (offset: number): number => image[offset]!;
  const [high, mid, low] = layout.cardNumber;
  const cardNumber = decodeCardNumber(at(high), at(mid), at(low));

  const field = (f: FieldLayout | undefined): SiStationRecord | undefined => {
    if (!f) return undefined;
    const dayByte = f.dayByte === undefined ? undefined : at(f.dayByte);
    const time = decodeSiTime(at(f.time), at(f.time + 1), dayByte);
    if (!time) return undefined;
    return f.code === undefined ? { time } : { time, code: decodeControlCode(at(f.code), dayByte) };
  };

  const punches: SiPunchRecord[] = [];
  if (cardType === "SI5") {
    // Räknaren pekar på nästa lediga plats, därför minus ett.
    const count = Math.max(0, Math.min(at(layout.punchCount) - 1, 36));
    let offset = layout.firstPunch;
    for (let index = 0; index < Math.min(count, layout.maxPunches); index += 1) {
      // Första byten i varje 16-byteblock är reserverad för stämpling 31–36.
      if (offset % 16 === 0) offset += 1;
      const time = decodeSiTime(at(offset + 1), at(offset + 2));
      punches.push(time ? { code: at(offset), time } : { code: at(offset) });
      offset += 3;
    }
    // Stämpling 31–36 sparar bara kontrollkod, i blockens första byte.
    for (let index = layout.maxPunches; index < count; index += 1) {
      punches.push({ code: at(32 + (index - layout.maxPunches) * 16) });
    }
  } else {
    const available = Math.max(0, Math.floor((image.length - layout.firstPunch) / layout.punchSize));
    const count = Math.min(at(layout.punchCount), layout.maxPunches);
    if (count > available) {
      throw new CardDecodeError(`Ofullständig avläsning av ${cardType}: ${count} stämplingar men bara plats för ${available}`);
    }
    for (let index = 0; index < count; index += 1) {
      const offset = layout.firstPunch + index * layout.punchSize;
      const dayByte = at(offset);
      const time = decodeSiTime(at(offset + 2), at(offset + 3), dayByte);
      const code = decodeControlCode(at(offset + 1), dayByte);
      punches.push(time ? { code, time } : { code });
    }
  }

  const start = field(layout.start);
  const finish = field(layout.finish);
  const check = field(layout.check);
  const clear = field(layout.clear);
  return {
    cardType,
    cardNumber,
    ...(start ? { start } : {}),
    ...(finish ? { finish } : {}),
    ...(check ? { check } : {}),
    ...(clear ? { clear } : {}),
    punches
  };
}

/** Sätter ihop svarsramarnas data till en minnesbild. */
export function cardImageFromResponses(cardType: SiCardType, responses: readonly Uint8Array[]): Uint8Array {
  if (cardType === "SI5") {
    // SI5-svaret är 128 byte rå data utan blocknummer.
    const data = responses[0];
    if (!data || data.length < BLOCK_SIZE) throw new CardDecodeError(`Kort block: ${data?.length ?? 0} byte`);
    return data.slice(0, BLOCK_SIZE);
  }
  // Övriga svar börjar med blocknumret. Placera blocken efter numret, inte efter ordningen: en station som är inställd
  // på att skicka alla åtta block (0–7) skickar även block 1–3 (SIAC: inställningar och batteridata), som inte är
  // stämplingar (natt-KM 2026-10-20).
  const byNumber = new Map<number, Uint8Array>();
  for (const data of responses) {
    const block = data.subarray(1);
    if (block.length < BLOCK_SIZE) throw new CardDecodeError(`Kort block: ${block.length} byte`);
    if (!byNumber.has(data[0]!)) byNumber.set(data[0]!, block.subarray(0, BLOCK_SIZE));
  }
  const wanted = cardImageBlocks(cardType);
  // Bilden går fram till första saknade blocket; decodeCard kontrollerar att stämplingarna ryms.
  const present: Uint8Array[] = [];
  for (const number of wanted) {
    const block = byNumber.get(number);
    if (!block) break;
    present.push(block);
  }
  if (present.length === 0) throw new CardDecodeError("Block 0 saknas");
  const image = new Uint8Array(present.length * BLOCK_SIZE);
  present.forEach((block, index) => image.set(block, index * BLOCK_SIZE));
  return image;
}
