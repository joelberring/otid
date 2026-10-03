import { describe, expect, it } from "vitest";
import {
  cardImageFromResponses,
  CardDecodeError,
  decodeCard,
  decodeCardNumber,
  encodeCardImage,
  expectedImageSize,
  normalizeCard,
  type SiCardType,
  type SimulatedCard
} from "../src";

// Lördag 3 oktober 2026 (lördag = 6).
const SAT = 6;
const at = (h: number, m: number, s = 0, dayOfWeek = SAT) => ({ secondsOfDay: h * 3600 + m * 60 + s, dayOfWeek });

function card(cardType: SiCardType, cardNumber: number, punchCount = 3): SimulatedCard {
  return {
    cardType,
    cardNumber,
    check: at(9, 55),
    start: at(10, 0),
    finish: at(10, 42, 17),
    punches: Array.from({ length: punchCount }, (_, i) => ({ code: 31 + i, time: at(10, 5 + i, 30) }))
  };
}

const cases: readonly [SiCardType, number, number][] = [
  ["SI5", 12345, 30],
  ["SI5", 412345, 5],
  ["SI6", 834567, 64],
  ["SI8", 2123456, 30],
  ["SI9", 1234567, 50],
  ["SI10", 7123456, 128],
  ["SI11", 9123456, 40],
  ["SIAC", 8123456, 64],
  ["pCard", 4123456, 20]
];

describe("decodeCard", () => {
  for (const [type, number, punches] of cases) {
    it(`avkodar ${type} ${number} med ${punches} stämplingar`, () => {
      const spec = card(type, number, punches);
      const decoded = decodeCard(type, encodeCardImage(spec));
      expect(decoded.cardType).toBe(type);
      expect(decoded.cardNumber).toBe(number);
      expect(decoded.punches).toHaveLength(punches);
      expect(decoded.punches.map((p) => p.code)).toEqual(spec.punches.map((p) => p.code));
      expect(decoded.start?.time.secondsIn12h).toBe(10 * 3600);
      expect(decoded.finish?.time.secondsIn12h).toBe(10 * 3600 + 42 * 60 + 17);
      expect(decoded.check?.time.secondsIn12h).toBe(9 * 3600 + 55 * 60);
      if (type === "SI5") {
        expect(decoded.start?.time.pm).toBeUndefined();
      } else {
        expect(decoded.start?.time).toEqual({ secondsIn12h: 36_000, pm: false, dayOfWeek: SAT });
        expect(decoded.punches[0]?.time).toEqual({ secondsIn12h: 10 * 3600 + 5 * 60 + 30, pm: false, dayOfWeek: SAT });
      }
    });
  }

  it("tolkar tom bricka utan tider eller stämplingar", () => {
    const decoded = decodeCard("SI9", encodeCardImage({ cardType: "SI9", cardNumber: 1_000_001, punches: [] }));
    expect(decoded).toEqual({ cardType: "SI9", cardNumber: 1_000_001, punches: [] });
  });

  it("läser eftermiddagstider och kontrollkoder över 255", () => {
    const decoded = decodeCard("SIAC", encodeCardImage({
      cardType: "SIAC",
      cardNumber: 8_000_001,
      finish: at(13, 2, 3),
      punches: [{ code: 301, time: at(12, 59) }]
    }));
    expect(decoded.finish?.time).toEqual({ secondsIn12h: 3600 + 2 * 60 + 3, pm: true, dayOfWeek: SAT });
    expect(decoded.punches[0]).toEqual({ code: 301, time: { secondsIn12h: 59 * 60, pm: true, dayOfWeek: SAT } });
  });

  it("vägrar för kort minnesbild", () => {
    expect(() => decodeCard("SI10", new Uint8Array(128))).toThrow(CardDecodeError);
  });

  it("SI5 stämpling 31–36 har bara kod", () => {
    const image = encodeCardImage(card("SI5", 5000, 30));
    image[23] = 33; // räknaren: 32 stämplingar
    image[32] = 61;
    image[48] = 62;
    const decoded = decodeCard("SI5", image);
    expect(decoded.punches).toHaveLength(32);
    expect(decoded.punches.slice(30)).toEqual([{ code: 61 }, { code: 62 }]);
  });

  it("räknar ut minnesbildernas storlek", () => {
    expect(expectedImageSize("SI5")).toBe(128);
    expect(expectedImageSize("SI6")).toBe(384);
    expect(expectedImageSize("SI8")).toBe(256);
    expect(expectedImageSize("SIAC")).toBe(640);
  });
});

describe("decodeCardNumber", () => {
  it("hanterar SI5-serier", () => {
    expect(decodeCardNumber(1, 0x30, 0x39)).toBe(12345);
    expect(decodeCardNumber(0, 0x30, 0x39)).toBe(12345);
    expect(decodeCardNumber(4, 0x30, 0x39)).toBe(412345);
  });

  it("hanterar nyare brickor som 24-bitarsnummer", () => {
    expect(decodeCardNumber(0x0c, 0xbc, 0x5f)).toBe(834_655);
    expect(decodeCardNumber(0x7b, 0xf9, 0xc0)).toBe(8_124_864);
  });
});

describe("cardImageFromResponses", () => {
  it("tar bort blocknummer och sätter ihop blocken", () => {
    const block = (n: number) => Uint8Array.from([n, ...new Uint8Array(128).fill(n)]);
    const image = cardImageFromResponses("SI6", [block(0), block(6), block(7)]);
    expect(image.length).toBe(384);
    expect(image[0]).toBe(0);
    expect(image[128]).toBe(6);
    expect(image[383]).toBe(7);
  });
});

describe("normalizeCard", () => {
  it("ger absoluta ISO-tider i tävlingens tidszon", () => {
    const decoded = decodeCard("SI10", encodeCardImage(card("SI10", 7_000_123, 2)));
    const normalized = normalizeCard(decoded, {
      reference: new Date("2026-10-03T08:50:00Z"), // 10:50 svensk sommartid
      timeZone: "Europe/Stockholm"
    });
    expect(normalized).toEqual({
      cardNumber: "7000123",
      cardType: "SI10",
      checkPunchedAt: "2026-10-03T07:55:00.000Z",
      startPunchedAt: "2026-10-03T08:00:00.000Z",
      finishPunchedAt: "2026-10-03T08:42:17.000Z",
      punches: [
        { code: 31, punchedAt: "2026-10-03T08:05:30.000Z" },
        { code: 32, punchedAt: "2026-10-03T08:06:30.000Z" }
      ],
      untimedPunchCodes: []
    });
  });
});
