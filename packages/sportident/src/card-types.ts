import { BLOCK_SIZE, Command, READ_ALL_BLOCKS } from "./constants";

export type SiCardType = "SI5" | "SI6" | "SI8" | "SI9" | "SI10" | "SI11" | "SIAC" | "pCard";

/** Hur en bricktyp läses ut: kommando, parametrar och antal svar. */
export interface CardReadStep {
  readonly command: number;
  readonly params: readonly number[];
  /** Antal svarsramar som kommandot ger. */
  readonly responses: number;
}

/**
 * Var i brickans minne fälten ligger. Offset räknas i den sammanfogade
 * minnesbilden av de block som läses ut (blocknummerbyten borttagen).
 */
export interface CardLayout {
  /** Offset för bricknumrets tre byte (hög, mellan, låg). På SI5 är den höga byten serien. */
  readonly cardNumber: readonly [high: number, mid: number, low: number];
  readonly start: FieldLayout;
  readonly finish: FieldLayout;
  readonly check: FieldLayout;
  readonly clear?: FieldLayout;
  readonly punchCount: number;
  readonly firstPunch: number;
  readonly punchSize: 3 | 4;
  readonly maxPunches: number;
}

export interface FieldLayout {
  /** Offset för tidens två byte. */
  readonly time: number;
  /** Offset för dag/AM-PM-byten (saknas på SI5). */
  readonly dayByte?: number;
  /** Offset för stationskoden som registrerades (saknas på SI5). */
  readonly code?: number;
}

const SI8_PLUS_COMMON = {
  cardNumber: [25, 26, 27] as const,
  start: { dayByte: 12, code: 13, time: 14 },
  finish: { dayByte: 16, code: 17, time: 18 },
  check: { dayByte: 8, code: 9, time: 10 },
  punchCount: 22,
  punchSize: 4 as const
};

export const CARD_LAYOUTS: Readonly<Record<SiCardType, CardLayout>> = {
  SI5: {
    cardNumber: [6, 4, 5],
    start: { time: 19 },
    finish: { time: 21 },
    check: { time: 25 },
    punchCount: 23,
    firstPunch: 32,
    punchSize: 3,
    maxPunches: 30
  },
  SI6: {
    cardNumber: [11, 12, 13],
    start: { dayByte: 24, code: 25, time: 26 },
    finish: { dayByte: 20, code: 21, time: 22 },
    check: { dayByte: 28, code: 29, time: 30 },
    clear: { dayByte: 32, code: 33, time: 34 },
    punchCount: 18,
    firstPunch: 128,
    punchSize: 4,
    maxPunches: 64
  },
  SI8: { ...SI8_PLUS_COMMON, firstPunch: 136, maxPunches: 30 },
  SI9: { ...SI8_PLUS_COMMON, firstPunch: 56, maxPunches: 50 },
  pCard: { ...SI8_PLUS_COMMON, firstPunch: 176, maxPunches: 20 },
  SI10: { ...SI8_PLUS_COMMON, firstPunch: 128, maxPunches: 128 },
  SI11: { ...SI8_PLUS_COMMON, firstPunch: 128, maxPunches: 128 },
  SIAC: { ...SI8_PLUS_COMMON, firstPunch: 128, maxPunches: 128 }
};

/** Utläsningssteg per bricktyp. */
export function cardReadPlan(type: SiCardType): readonly CardReadStep[] {
  switch (type) {
    case "SI5":
      return [{ command: Command.READ_SI5, params: [], responses: 1 }];
    case "SI6":
      // Block 0, 6 och 7 kommer i följd.
      return [{ command: Command.READ_SI6, params: [READ_ALL_BLOCKS], responses: 3 }];
    case "SI8":
    case "SI9":
    case "pCard":
      return [
        { command: Command.READ_SI8_PLUS, params: [0], responses: 1 },
        { command: Command.READ_SI8_PLUS, params: [1], responses: 1 }
      ];
    case "SI10":
    case "SI11":
    case "SIAC":
      // Block 0, 4, 5, 6 och 7 kommer i följd; block 1–3 hoppas över.
      return [{ command: Command.READ_SI8_PLUS, params: [READ_ALL_BLOCKS], responses: 5 }];
  }
}

/**
 * Vilka block i brickans minne som bildar minnesbilden, i ordning (layouten räknar offset i den här bilden).
 * SI6 och SI10/11/SIAC läses med "alla block": beroende på stationens inställning skickar den antingen just de här
 * blocken (0, 6, 7 respektive 0, 4–7) eller alla åtta (0–7). Blocknumret i svaret avgör vad som är vad.
 */
export function cardImageBlocks(type: SiCardType): readonly number[] {
  switch (type) {
    case "SI5": return [0];
    case "SI6": return [0, 6, 7];
    case "SI8": case "SI9": case "pCard": return [0, 1];
    case "SI10": case "SI11": case "SIAC": return [0, 4, 5, 6, 7];
  }
}

/** Sista blocket som stationen skickar vid "alla block", i båda lägena. */
export const LAST_BLOCK = 7;

/** Stämplingar per 128-byteblock (fyra byte per stämpling) på SI6 och SI10/11/SIAC. */
export const PUNCHES_PER_BLOCK = 32;

/**
 * Steg 53: kommandot för snabb utläsning (block 0 först, sedan bara blocken med stämplingar, ett i taget), eller
 * undefined för bricktyper som läses som förut (SI5 ett svar, SI8/SI9/pCard block 0 och 1).
 */
export function fastReadCommand(type: SiCardType): number | undefined {
  switch (type) {
    case "SI6": return Command.READ_SI6;
    case "SI10": case "SI11": case "SIAC": return Command.READ_SI8_PLUS;
    default: return undefined;
  }
}

/**
 * Steg 53: blocken som ska läsas efter block 0, i ordning, utifrån antalet stämplingar i block 0. Antalet begränsas
 * till brickans största antal på samma sätt som `decodeCard` gör, så att resultatet blir detsamma som med "alla block".
 * SIAC läser även block 1 före stämplingarna, som MeOS gör ("to handle SIACs using Beacon"); blocket ingår inte i
 * minnesbilden. Undefined för bricktyper utan snabb utläsning.
 */
export function fastReadBlocks(type: SiCardType, block0: Uint8Array): readonly number[] | undefined {
  const punchBlocks = type === "SI6" ? [6, 7] : type === "SI10" || type === "SI11" || type === "SIAC" ? [4, 5, 6, 7] : undefined;
  if (!punchBlocks) return undefined;
  const layout = CARD_LAYOUTS[type];
  const count = Math.min(block0[layout.punchCount] ?? 0, layout.maxPunches);
  return [...(type === "SIAC" ? [1] : []), ...punchBlocks.slice(0, Math.ceil(count / PUNCHES_PER_BLOCK))];
}

/** Förväntad minnesstorlek efter utläsning, för kontroll. */
export function expectedImageSize(type: SiCardType): number {
  return cardReadPlan(type).reduce((sum, step) => sum + step.responses, 0) * BLOCK_SIZE;
}

/** Bricktyp utifrån bricknummer, för kort som rapporteras med SI8_PLUS_DETECTED. */
export function cardTypeFromSi8PlusNumber(cardNumber: number): SiCardType | undefined {
  if (cardNumber >= 1_000_000 && cardNumber <= 1_999_999) return "SI9";
  if (cardNumber >= 2_000_000 && cardNumber <= 2_999_999) return "SI8";
  if (cardNumber >= 4_000_000 && cardNumber <= 4_999_999) return "pCard";
  if (cardNumber >= 7_000_000 && cardNumber <= 7_999_999) return "SI10";
  if (cardNumber >= 8_000_000 && cardNumber <= 8_999_999) return "SIAC";
  if (cardNumber >= 9_000_000 && cardNumber <= 9_999_999) return "SI11";
  return undefined;
}

/**
 * Tolkar bricknumrets tre byte. Värden under 500 000 är SI5, där den höga
 * byten är serien och kortet visar serie * 100 000 + 16-bitarsnumret för
 * serie 2–4 (serie 0 och 1 visar bara numret).
 */
export function decodeCardNumber(high: number, mid: number, low: number): number {
  const full = (high << 16) | (mid << 8) | low;
  if (full < 500_000) {
    // SI5: high är serien, mid/low är numret.
    const number = (mid << 8) | low;
    return high < 2 ? number : high * 100_000 + number;
  }
  return full;
}
