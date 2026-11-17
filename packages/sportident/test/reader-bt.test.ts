import { describe, expect, it } from "vitest";
import {
  CardDecodeError, decodeReaderBtCard, decodeRecordedFrames, normalizeCard, ReaderBtAssembler, readerBtCardEvent, readerBtCardNumber,
  readerBtSerial, readerBtStorageFrames
} from "../src";

const hex = (value: string) => Uint8Array.from(value.match(/../g)!, (pair) => parseInt(pair, 16));

/**
 * Riktiga notifieringar från en Reader BT (serienummer 1000298), inspelade 2026-11-17. SI11-brickans ägaruppgifter
 * (namn, e-post, telefon) är utbytta mot "9150186;Testklubb;;;;" med samma längd.
 */
const SI9_1200002 = "03114000824f120001040000010100c0b4171900020100c0b41719000518009040cc2100073200c086bf2101313230303030323b53504f52546964656e74205377656465";
const SI9_1506987 = "03118000abfe1600010c000001020030cd440e0002020030cd440e00030300e8374a0e000504006004790e00073000b8b64b0e0007330078b45b0e00072f0040db5d0e00073100b897650e00073200b808680e00072300006e6a0e00072d0030c56f0e00072b00c083760e01000000000000000000000000000000000000000000000000";
const SI11_9150186 = [
  "01a1f400013101000003112d01ea9e8b000f130000020600e8c950020001020080224c0200050a0048b1900200060a0048b190020007290028c5560200072b00487e5a020007310030b766020007320070b86b0200073300d8e26f020007520040607b0200075700405a7c0200073b007034810200073900300f820200073d00b035860200073e00e027870200074f00a002880200075400d83a8b0200075b0000528d0200076400183c90020c195701100000000c0b1b0c0b01393135303138363b546573746b6c7562623b3b3b3b0000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  "01a1430002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
];

/** h:m:s på en veckodag (0 = söndag) som brickans tid. */
const at = (day: number, h: number, m: number, s: number) => ({ secondsIn12h: (h % 12) * 3600 + m * 60 + s, pm: h >= 12, dayOfWeek: day });

describe("Reader BT", () => {
  it("avkodar en SI9 i ett meddelande", () => {
    const card = decodeReaderBtCard(hex(SI9_1200002));
    expect(card).toEqual({
      cardType: "SI9", cardNumber: 1_200_002,
      clear: { code: 1, time: at(4, 20, 56, 24) }, check: { code: 1, time: at(4, 20, 56, 24) },
      finish: { code: 24, time: at(6, 13, 30, 34) },
      punches: [{ code: 50, time: at(6, 13, 16, 40) }]
    });
  });

  it("avkodar start, mål och stämplingar i ordning", () => {
    const card = decodeReaderBtCard(hex(SI9_1506987));
    expect(card.start).toEqual({ code: 3, time: at(2, 18, 35, 45) });
    expect(card.finish).toEqual({ code: 4, time: at(2, 19, 26, 52) });
    expect(card.punches.map((punch) => punch.code)).toEqual([48, 51, 47, 49, 50, 35, 45, 43]);
    expect(card.punches[0]).toEqual({ code: 48, time: at(2, 18, 37, 23) });
  });

  it("sätter ihop en SI11 i två bitar och hoppar över posttyp 6", () => {
    const assembler = new ReaderBtAssembler();
    expect(assembler.push(hex(SI11_9150186[0]!))).toBeUndefined();
    const message = assembler.push(hex(SI11_9150186[1]!))!;
    expect(message).toHaveLength(305);
    expect(assembler.frames).toHaveLength(2);
    const card = decodeReaderBtCard(message);
    expect(card.cardType).toBe("SI11");
    expect(card.clear).toEqual({ code: 2, time: at(0, 10, 42, 24) });
    expect(card.check).toEqual({ code: 6, time: at(0, 10, 47, 29) });
    expect(card.finish).toEqual({ code: 10, time: at(0, 11, 57, 17) });
    expect(card.start).toBeUndefined();
    expect(card.punches.map((punch) => punch.code)).toEqual([41, 43, 49, 50, 51, 82, 87, 59, 57, 61, 62, 79, 84, 91, 100]);
  });

  it("läser om sparade råramar, även delade för lagring", () => {
    const frames = SI11_9150186.map(hex);
    const direct = decodeRecordedFrames(frames);
    expect(direct.cardNumber).toBe(9_150_186);
    // Den första biten delas i två; den andra (71 byte) får plats i en.
    const split = readerBtStorageFrames([frames[0]!.slice(0, 100), frames[0]!.slice(100), frames[1]!]);
    expect(split).toHaveLength(3);
    expect(decodeRecordedFrames(split)).toEqual(direct);
    expect(() => decodeRecordedFrames([...split, hex(SI9_1506987).slice(0, 100)])).toThrow(/mitt i ett meddelande/);
    expect(readerBtStorageFrames([new Uint8Array(650)]).map((frame) => frame.length)).toEqual([300, 300, 50]);
  });

  it("ger tider i tävlingens tidszon", () => {
    const normalized = normalizeCard(decodeReaderBtCard(hex(SI9_1506987)),
      { reference: new Date("2026-11-17T19:40:00+01:00"), timeZone: "Europe/Stockholm" });
    // 18:35:45 och 19:26:52 svensk tid (UTC+1) på tisdagen.
    expect(normalized.startPunchedAt).toBe("2026-11-17T17:35:45.000Z");
    expect(normalized.finishPunchedAt).toBe("2026-11-17T18:26:52.000Z");
  });

  it("gissar inte vid okänt innehåll", () => {
    const flagged = hex(SI9_1200002); flagged[11] = 0x01;
    expect(() => decodeReaderBtCard(flagged)).toThrow(/okänd flagga/);
    const kind = hex(SI9_1200002); kind[12] = 0x04;
    expect(() => decodeReaderBtCard(kind)).toThrow(/okänd typ 4/);
    const twoFinishes = hex(SI9_1200002); twoFinishes[12 + 3 * 8] = 0x05;
    expect(() => decodeReaderBtCard(twoFinishes)).toThrow(/två poster/);
    expect(() => decodeReaderBtCard(hex(SI9_1200002).slice(0, 40))).toThrow(CardDecodeError);
    const si6 = hex(SI9_1200002); si6.set([0x20, 0xa1, 0x07, 0x00], 4);
    expect(readerBtCardNumber(si6)).toBe(500_000);
    expect(() => decodeReaderBtCard(si6)).toThrow(/stöds inte/);
    expect(() => new ReaderBtAssembler().push(hex(SI11_9150186[1]!))).toThrow(/bit 1 väntades/);
    expect(() => decodeRecordedFrames([hex(SI11_9150186[0]!)])).toThrow(/inte komplett/);
  });

  it("läser bricka i och ur och serienumret ur namnet", () => {
    expect(readerBtCardEvent(hex("01110700824f1200010500"))).toEqual({ cardNumber: 1_200_002, inserted: true });
    expect(readerBtCardEvent(hex("01110700824f1200000500"))).toEqual({ cardNumber: 1_200_002, inserted: false });
    expect(readerBtSerial("Reader BT 1000298")).toBe(1_000_298);
    expect(readerBtSerial(undefined)).toBeUndefined();
  });
});
