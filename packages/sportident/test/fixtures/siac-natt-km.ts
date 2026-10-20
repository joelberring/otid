import { Command, encodeStationFrame } from "../../src";

/**
 * Natt-KM 2026-10-20: block 0–7 från en riktig SIAC (avläst i efterhand, bricknumret utbytt). Delas av
 * `siac-eight-blocks.test.ts` och omläsningen från rådata (steg 36, `packages/application`).
 */
export const NATT_KM_STATION = 0x1a;
export const NATT_KM_CARD = 8_001_234;
/** Kvällens stämplingar i brickans ordning. */
export const NATT_KM_CODES = [31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 52, 43];

const hex = (value: string) => Uint8Array.from(value.match(/../g)!.map((pair) => parseInt(pair, 16)));
const block = (runs: readonly [offset: number, data: string][]) => {
  const bytes = new Uint8Array(128).fill(0xee);
  for (const [offset, data] of runs) bytes.set(hex(data), offset);
  return bytes;
};

export function nattKmBlocks(cardNumber = NATT_KM_CARD): Record<number, Uint8Array> {
  const cardBytes = [(cardNumber >> 16) & 0xff, (cardNumber >> 8) & 0xff, cardNumber & 0xff];
  return {
    0: (() => {
      const value = block([[0, "e8797a9feaeaeaea35025b7f15035f9c05046c1f0d450e620f000000071921223b3b3b3b3b3b3b3b3b3b3b"]]);
      value.set(cardBytes, 25);
      return value;
    })(),
    1: block([[32, "07001a070303030304040404ebebebeb02000200020002000200020002000200020002000200020002000200"]]),
    2: block([]),
    3: block([[112, "73696163ffffffff0384007e06310000"]]),
    4: block([[0, "051f6024052060db05216139052262900523632505246498052565160526660f0527672a052868c3052969ae052a69e105346ae4052b6bbb"]]),
    5: block([]), 6: block([]), 7: block([])
  };
}

export function nattKmDetection(cardNumber = NATT_KM_CARD): Uint8Array {
  return encodeStationFrame(Command.SI8_PLUS_DETECTED, NATT_KM_STATION,
    [0x0f, (cardNumber >> 16) & 0xff, (cardNumber >> 8) & 0xff, cardNumber & 0xff]);
}

export function nattKmBlockFrame(number: number, cardNumber = NATT_KM_CARD): Uint8Array {
  return encodeStationFrame(Command.READ_SI8_PLUS, NATT_KM_STATION, [number, ...nattKmBlocks(cardNumber)[number]!]);
}
