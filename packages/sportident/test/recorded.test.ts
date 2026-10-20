import { describe, expect, it } from "vitest";
import {
  Command, CardDecodeError, decodeCard, decodeRecordedFrames, encodeCardImage, encodeStationFrame, framesFromHex, normalizeCard,
  type SimulatedCard
} from "../src";
import { NATT_KM_CARD, NATT_KM_CODES, nattKmBlockFrame, nattKmBlocks, nattKmDetection } from "./fixtures/siac-natt-km";

/** Steg 36: en sparad avläsning läses om från råramarna (detektering och svar) med den nuvarande avkodningen. */
const oldFrames = () => [nattKmDetection(), ...[0, 1, 2, 3, 4].map((number) => nattKmBlockFrame(number))];
const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

describe("decodeRecordedFrames", () => {
  it("natt-KM: detektering + block 0–4 ger kvällens 14 stämplingar, inte brickans inställningar", () => {
    const card = decodeRecordedFrames(oldFrames());
    expect(card.cardNumber).toBe(NATT_KM_CARD);
    expect(card.punches.map((punch) => punch.code)).toEqual(NATT_KM_CODES);
    const normalized = normalizeCard(card, { reference: new Date("2026-10-20T18:05:00Z"), timeZone: "Europe/Stockholm" });
    expect(normalized.startPunchedAt).toBe("2026-10-20T16:47:56.000Z");
    expect(normalized.finishPunchedAt).toBe("2026-10-20T17:41:19.000Z");
    // Den gamla avläsningen lade block 1–4 där block 4–7 ska vara: andra stämplingar än brickans.
    const blocks = nattKmBlocks();
    const image = new Uint8Array(5 * 128);
    [0, 1, 2, 3, 4].forEach((number, index) => image.set(blocks[number]!, index * 128));
    expect(decodeCard("SIAC", image).punches.map((punch) => punch.code)).not.toEqual(NATT_KM_CODES);
  });

  it("alla åtta block, dubbletter och en uttagsram efteråt ger samma bricka", () => {
    const frames = [nattKmDetection(), ...[0, 1, 2, 3, 4, 4, 5, 6, 7].map((number) => nattKmBlockFrame(number)),
      encodeStationFrame(Command.CARD_REMOVED, 0x1a, [0, 0, 0, 0])];
    expect(decodeRecordedFrames(frames).punches.map((punch) => punch.code)).toEqual(NATT_KM_CODES);
  });

  it("hex fram och tillbaka", () => {
    expect(decodeRecordedFrames(framesFromHex(oldFrames().map(toHex))).punches).toHaveLength(14);
    expect(() => framesFromHex(["0g"])).toThrow(CardDecodeError);
  });

  it("fel kontrollsumma, avbruten ram, två ramar i en, saknade block och fel bricknummer går inte att läsa om", () => {
    const corrupt = oldFrames();
    corrupt[5] = Uint8Array.from(corrupt[5]!, (byte, index) => index === 20 ? byte ^ 0xff : byte);
    expect(() => decodeRecordedFrames(corrupt)).toThrow(/kontrollsumma/);
    const truncated = oldFrames();
    truncated[5] = truncated[5]!.subarray(0, 60);
    expect(() => decodeRecordedFrames(truncated)).toThrow(CardDecodeError);
    const joined = oldFrames();
    expect(() => decodeRecordedFrames([joined[0]!, Uint8Array.from([...joined[1]!, ...joined[2]!])])).toThrow(CardDecodeError);
    // Utan block 4 finns inte de 14 stämplingarna som brickan säger att den har.
    expect(() => decodeRecordedFrames(oldFrames().slice(0, 5))).toThrow(/Ofullständig/);
    expect(() => decodeRecordedFrames([nattKmDetection()])).toThrow(CardDecodeError);
    expect(() => decodeRecordedFrames(oldFrames().slice(1))).toThrow(/Detektering/);
    expect(() => decodeRecordedFrames([nattKmDetection(8_009_999), ...oldFrames().slice(1)])).toThrow(/stämmer inte/);
  });

  it("SI5, SI6, SI8 och SI10 med samma ramar som avläsningen sparar", () => {
    const at = (minute: number) => ({ secondsOfDay: 19 * 3600 + minute * 60, dayOfWeek: 2 });
    const cases: [SimulatedCard["cardType"], number, number, number[][]][] = [
      ["SI5", 12345, Command.READ_SI5, [[]]],
      ["SI6", 765432, Command.READ_SI6, [[0], [6], [7]]],
      ["SI8", 2123456, Command.READ_SI8_PLUS, [[0], [1]]],
      ["SI10", 7123456, Command.READ_SI8_PLUS, [[0], [4], [5], [6], [7]]]
    ];
    for (const [cardType, cardNumber, command, blocks] of cases) {
      const spec: SimulatedCard = { cardType, cardNumber, start: at(0), finish: at(40),
        punches: [31, 32, 33].map((code, index) => ({ code, time: at(5 + index) })) };
      const image = encodeCardImage(spec);
      const detectedCommand = cardType === "SI5" ? Command.SI5_DETECTED : cardType === "SI6" ? Command.SI6_DETECTED : Command.SI8_PLUS_DETECTED;
      const detection = encodeStationFrame(detectedCommand, 1, [0, (cardNumber >> 16) & 0xff, (cardNumber >> 8) & 0xff, cardNumber & 0xff]);
      const replies = blocks.map(([number], index) => encodeStationFrame(command, 1,
        number === undefined ? image.subarray(0, 128) : [number, ...image.subarray(index * 128, index * 128 + 128)]));
      const card = decodeRecordedFrames([detection, ...replies]);
      expect([cardType, card.cardNumber, card.punches.map((punch) => punch.code)]).toEqual([cardType, cardNumber, [31, 32, 33]]);
    }
  });
});
