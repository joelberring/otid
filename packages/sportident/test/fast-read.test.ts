import { describe, expect, it } from "vitest";
import {
  ACK, BLOCK_SIZE, cardImageFromResponses, Command, decodeRecordedFrames, encodeCardImage, fastReadBlocks, FakeSiStation, FrameDecoder,
  ReadoutSession, type FakeStationOptions, type ReadoutEvent, type SiCardType, type SimulatedCard
} from "../src";
import { NATT_KM_CARD, NATT_KM_CODES, NATT_KM_STATION, nattKmBlockFrame, nattKmBlocks } from "./fixtures/siac-natt-km";

/**
 * Steg 53: snabb utläsning av SI6 och SI10/11/SIAC. Block 0 först, sedan bara blocken med stämplingar, ett i taget.
 * Allt oväntat (NAK, fel block, tidsgräns, data som inte går ihop med block 0) ger "alla block" för samma bricka.
 */
const NUMBERS: Record<SiCardType, number> = {
  SI5: 54_321, SI6: 765_432, SI8: 2_000_123, SI9: 1_000_123, SI10: 7_000_123, SI11: 9_000_123, SIAC: 8_001_234, pCard: 4_000_123
};
const at = (seconds: number) => ({ secondsOfDay: 18 * 3600 + seconds, dayOfWeek: 2 });

function card(cardType: SiCardType, punches: number): SimulatedCard {
  return { cardType, cardNumber: NUMBERS[cardType], start: at(0), finish: at(9_000), check: at(-300),
    punches: Array.from({ length: punches }, (_value, index) => ({ code: 31 + (index % 200), time: at(10 + index * 7) })) };
}

/** Blocken för en bricka, efter blocknummer, så som den falska stationen lagrar dem. */
function blocksOf(spec: SimulatedCard, patch?: (blocks: Map<number, Uint8Array>) => void): Map<number, Uint8Array> {
  const image = encodeCardImage(spec);
  const numbers = spec.cardType === "SI6" ? [0, 6, 7] : [0, 4, 5, 6, 7];
  const blocks = new Map(numbers.map((number, index) => [number, image.slice(index * BLOCK_SIZE, (index + 1) * BLOCK_SIZE)] as const));
  patch?.(blocks);
  return blocks;
}

interface Run {
  readonly events: ReadoutEvent[];
  /** Kommandon som skickades efter detekteringen (läsning och kvittens). */
  readonly sent: Uint8Array[];
  /** Svar från stationen efter detekteringen. */
  readonly replies: Uint8Array[];
}

/** Handskakar och läser en bricka; `timeouts` tidsgränser löses ut när stationen inte svarar. */
function read(insert: (station: FakeSiStation) => Uint8Array[], options: FakeStationOptions = {}, fastRead = true): Run {
  const station = new FakeSiStation(options);
  const session = new ReadoutSession({ fastRead });
  const run: Run = { events: [], sent: [], replies: [] };
  let reading = false;
  const deliver = (frames: readonly Uint8Array[]): void => {
    for (const frame of frames) {
      if (reading) run.replies.push(frame);
      const output = session.receive(frame);
      run.events.push(...output.events);
      send(output.send);
    }
  };
  const send = (commands: readonly Uint8Array[]): void => {
    for (const command of commands) {
      if (reading) run.sent.push(command);
      deliver(station.receive(command));
    }
  };
  send(session.start().send);
  const [detection, ...rest] = insert(station);
  reading = true;
  const first = session.receive(detection!);
  run.events.push(...first.events);
  send(first.send);
  deliver(rest);
  // Stationen svarar inte: värdens tidsgräns löper ut (högst två gånger: snabbförsöket och "alla block").
  for (let attempt = 0; attempt < 2 && session.expectsResponse; attempt += 1) {
    const output = session.timeout();
    run.events.push(...output.events);
    send(output.send);
  }
  return run;
}

const cardRead = (run: Run) => {
  const event = run.events.find((value) => value.type === "card-read");
  if (event?.type !== "card-read") throw new Error(JSON.stringify(run.events.map((value) => value.type)));
  return event;
};
/** Blocken som begärdes, i ordning ("alla" för 0x08, "-" för kommando utan block). Ramen är [0xFF] STX cmd len param … */
const requested = (run: Run) => run.sent.filter((bytes) => bytes.length > 1)
  .map((bytes) => bytes[3] === 0 ? "-" : bytes[4] === 0x08 ? "alla" : bytes[4]);
const blockOf = (frame: Uint8Array) => {
  const events = new FrameDecoder().push(frame);
  return events[0]?.kind === "frame" ? events[0].frame : undefined;
};

describe("fastReadBlocks", () => {
  const block0 = (cardType: SiCardType, count: number) => {
    const block = new Uint8Array(BLOCK_SIZE).fill(0xee);
    block[cardType === "SI6" ? 18 : 22] = count;
    return block;
  };
  it("SI10/SI11: block 4, 5, … efter antalet stämplingar, 32 per block", () => {
    for (const cardType of ["SI10", "SI11"] as const) {
      expect([0, 1, 32, 33, 64, 65, 96, 97, 128].map((count) => fastReadBlocks(cardType, block0(cardType, count))))
        .toEqual([[], [4], [4], [4, 5], [4, 5], [4, 5, 6], [4, 5, 6], [4, 5, 6, 7], [4, 5, 6, 7]]);
    }
  });
  it("SIAC: block 1 först (som MeOS), sedan stämplingsblocken; 128+ läser alla fyra", () => {
    expect([0, 1, 32, 33, 64, 128, 129, 0xee].map((count) => fastReadBlocks("SIAC", block0("SIAC", count))))
      .toEqual([[1], [1, 4], [1, 4], [1, 4, 5], [1, 4, 5], [1, 4, 5, 6, 7], [1, 4, 5, 6, 7], [1, 4, 5, 6, 7]]);
  });
  it("SI6: block 6 och 7 efter antalet; över 64 läser båda (som \"alla block\")", () => {
    expect([0, 1, 32, 33, 64, 65, 0xee].map((count) => fastReadBlocks("SI6", block0("SI6", count))))
      .toEqual([[], [6], [6], [6, 7], [6, 7], [6, 7], [6, 7]]);
  });
  it("SI5, SI8, SI9 och pCard läses som förut", () => {
    for (const cardType of ["SI5", "SI8", "SI9", "pCard"] as const) expect(fastReadBlocks(cardType, block0(cardType, 3))).toBeUndefined();
  });
});

describe("snabb utläsning mot den falska stationen", () => {
  const cases: [SiCardType, number, (number | "alla")[]][] = [
    ["SI10", 0, [0]], ["SI10", 1, [0, 4]], ["SI10", 32, [0, 4]], ["SI10", 33, [0, 4, 5]], ["SI10", 64, [0, 4, 5]],
    ["SI10", 128, [0, 4, 5, 6, 7]], ["SI11", 20, [0, 4]], ["SIAC", 0, [0, 1]], ["SIAC", 20, [0, 1, 4]], ["SIAC", 33, [0, 1, 4, 5]],
    ["SIAC", 128, [0, 1, 4, 5, 6, 7]], ["SI6", 0, [0]], ["SI6", 1, [0, 6]], ["SI6", 32, [0, 6]], ["SI6", 33, [0, 6, 7]],
    ["SI6", 64, [0, 6, 7]]
  ];
  for (const eightBlocks of [false, true]) {
    for (const [cardType, punches, blocks] of cases) {
      it(`${cardType} med ${punches} stämplingar${eightBlocks ? " (station med alla åtta block)" : ""}: block ${blocks.join(", ")} ger bit för bit samma bild som "alla block"`, () => {
        const spec = card(cardType, punches);
        const fast = read((station) => station.insert(spec), { eightBlocks });
        const full = read((station) => station.insert(spec), { eightBlocks }, false);
        expect(requested(fast)).toEqual(blocks);
        expect(requested(full)).toEqual(["alla"]);
        const fastRead = cardRead(fast);
        const fullRead = cardRead(full);
        expect(fastRead.readMode).toBe("fast");
        expect(fullRead.readMode).toBe("full");
        expect(fastRead.card).toEqual(fullRead.card);
        expect(fastRead.card.punches).toHaveLength(punches);
        // Varje block som lästes snabbt är byte för byte samma ram som samma block i "alla block".
        const fullByBlock = new Map(fullRead.frames.slice(1).map((frame) => [blockOf(frame)!.data[0], frame] as const));
        // (SIAC:s block 1 skickas bara av en station inställd på alla åtta block.)
        for (const frame of fastRead.frames.slice(1)) {
          const number = blockOf(frame)!.data[0]!;
          if (fullByBlock.has(number) || number !== 1) expect(frame).toEqual(fullByBlock.get(number));
        }
        expect(fastRead.frames[0]).toEqual(fullRead.frames[0]);
        // Minnesbilden är början av "alla block"-bilden: allt som avkodningen läser är detsamma.
        const image = (frames: readonly Uint8Array[]) => cardImageFromResponses(cardType, frames.slice(1).map((frame) => blockOf(frame)!.data));
        const fastImage = image(fastRead.frames);
        expect(fastImage).toEqual(image(fullRead.frames).subarray(0, fastImage.length));
        // Omläsning från råramarna (steg 36) ger samma bricka.
        expect(decodeRecordedFrames(fastRead.frames)).toEqual(fullRead.card);
        expect(fast.sent.at(-1)).toEqual(Uint8Array.of(ACK));
        expect(fast.events.some((event) => event.type === "fast-read-fallback")).toBe(false);
      });
    }
  }

  it("SIAC med mer än 128 i räknaren: alla fyra stämplingsblock, samma 128 stämplingar som \"alla block\"", () => {
    for (const counter of [129, 0xee]) {
      const blocks = blocksOf(card("SIAC", 128), (map) => { map.get(0)![22] = counter; });
      const fast = read((station) => station.insertBlocks("SIAC", NUMBERS.SIAC, blocks));
      const full = read((station) => station.insertBlocks("SIAC", NUMBERS.SIAC, blocks), {}, false);
      expect(requested(fast)).toEqual([0, 1, 4, 5, 6, 7]);
      expect(cardRead(fast).card).toEqual(cardRead(full).card);
      expect(cardRead(fast).card.punches).toHaveLength(128);
    }
  });

  it("SI6 med mer än 64 i räknaren (SI6*): block 6 och 7, samma som \"alla block\"", () => {
    const blocks = blocksOf(card("SI6", 64), (map) => { map.get(0)![18] = 100; });
    const fast = read((station) => station.insertBlocks("SI6", NUMBERS.SI6, blocks));
    const full = read((station) => station.insertBlocks("SI6", NUMBERS.SI6, blocks), {}, false);
    expect(requested(fast)).toEqual([0, 6, 7]);
    expect(cardRead(fast).card).toEqual(cardRead(full).card);
  });

  it("SI5, SI8 och SI9 läses som förut", () => {
    expect(requested(read((station) => station.insert(card("SI5", 5))))).toEqual(["-"]);
    expect(requested(read((station) => station.insert(card("SI8", 5))))).toEqual([0, 1]);
    expect(requested(read((station) => station.insert(card("SI9", 5))))).toEqual([0, 1]);
    expect(cardRead(read((station) => station.insert(card("SI9", 5)))).readMode).toBe("full");
  });

  it("avstängd snabb utläsning och station utan handskakning läser som förut", () => {
    expect(requested(read((station) => station.insert(card("SIAC", 5)), {}, false))).toEqual(["alla"]);
    const unrequested = read((station) => station.insert(card("SIAC", 5)), { handshake: false });
    expect(requested(unrequested)).toEqual([]);
    expect(cardRead(unrequested).readMode).toBe("full");
    const session = new ReadoutSession();
    expect(session.fastRead).toBe(true);
    session.fastRead = false;
    expect(session.fastRead).toBe(false);
  });

  it("natt-KM: den riktiga SIAC:ens block ger kvällens 14 stämplingar med block 0, 1 och 4, samma ramar som inspelningen", () => {
    const blocks = new Map(Object.entries(nattKmBlocks()).map(([number, data]) => [Number(number), data] as const));
    for (const eightBlocks of [false, true]) {
      const fast = read((station) => station.insertBlocks("SIAC", NATT_KM_CARD, blocks), { stationCode: NATT_KM_STATION, eightBlocks });
      expect(requested(fast)).toEqual([0, 1, 4]);
      const result = cardRead(fast);
      expect(result.card.punches.map((punch) => punch.code)).toEqual(NATT_KM_CODES);
      expect(result.frames.slice(1)).toEqual([0, 1, 4].map((number) => nattKmBlockFrame(number)));
      expect(result.card).toEqual(cardRead(read((station) => station.insertBlocks("SIAC", NATT_KM_CARD, blocks),
        { stationCode: NATT_KM_STATION, eightBlocks: true }, false)).card);
    }
  });
});

describe("reservvägen: \"alla block\" för samma bricka", () => {
  const spec = card("SIAC", 40);
  const full = () => cardRead(read((station) => station.insert(spec), {}, false));

  for (const [answer, block, reason] of [
    ["nak", 4, "nak"], ["nak", 0, "nak"], ["wrong-block", 5, "wrong-block"], ["wrong-block", 0, "wrong-block"],
    ["silent", 4, "timeout"], ["silent", 1, "timeout"]
  ] as const) {
    it(`${answer} på block ${block}: läses med "alla block", loggas, inget går förlorat`, () => {
      for (const eightBlocks of [false, true]) {
        const run = read((station) => station.insert(spec), { singleBlockFault: { block, answer }, eightBlocks });
        const fallback = run.events.find((event) => event.type === "fast-read-fallback");
        expect(fallback).toMatchObject({ type: "fast-read-fallback", cardNumber: NUMBERS.SIAC, cardType: "SIAC", reason });
        expect(requested(run).at(-1)).toBe("alla");
        expect(run.events.filter((event) => event.type === "card-read")).toHaveLength(1);
        expect(run.events.some((event) => event.type === "read-failed")).toBe(false);
        const result = cardRead(run);
        expect(result.readMode).toBe("full");
        expect(result.card).toEqual(full().card);
        // Avläsningen sparar bara detekteringen och "alla block"-svaren, så att omläsning ger samma bild.
        expect(result.frames).toEqual(cardRead(read((station) => station.insert(spec), { eightBlocks }, false)).frames);
        expect(run.sent.at(-1)).toEqual(Uint8Array.of(ACK));
      }
    });
  }

  it("block 0 från en annan bricka: \"alla block\", och samma besked som förut om den också är fel", () => {
    const other = blocksOf(card("SIAC", 3));
    other.get(0)!.set([0x7a, 0x12, 0x34], 25);
    const run = read((station) => station.insertBlocks("SIAC", NUMBERS.SIAC, other));
    expect(run.events.find((event) => event.type === "fast-read-fallback")).toMatchObject({ reason: "mismatch" });
    expect(run.events.find((event) => event.type === "read-failed")).toMatchObject({ reason: "mismatch" });
  });

  it("stämplingsblock som inte går ihop med block 0 (tomma stämplingar): \"alla block\" avgör", () => {
    const blocks = blocksOf(card("SI10", 3), (map) => map.get(4)!.fill(0xee));
    const run = read((station) => station.insertBlocks("SI10", NUMBERS.SI10, blocks));
    expect(run.events.find((event) => event.type === "fast-read-fallback")).toMatchObject({ reason: "inconsistent" });
    const result = cardRead(run);
    expect(result.readMode).toBe("full");
    expect(result.card).toEqual(cardRead(read((station) => station.insertBlocks("SI10", NUMBERS.SI10, blocks), {}, false)).card);
  });

  it("tidsgräns även med \"alla block\": misslyckad avläsning som förut, nästa bricka läses", () => {
    const station = new FakeSiStation();
    const session = new ReadoutSession();
    const events: ReadoutEvent[] = [];
    const pump = (commands: readonly Uint8Array[]): void => {
      for (const command of commands) for (const reply of station.receive(command)) {
        const output = session.receive(reply);
        events.push(...output.events);
        pump(output.send);
      }
    };
    pump(session.start().send);
    const [detection] = station.insert(spec);
    events.push(...session.receive(detection!).events);
    for (let attempt = 0; attempt < 2; attempt += 1) events.push(...session.timeout().events);
    expect(events.map((event) => event.type)).toEqual(["station-ready", "card-inserted", "fast-read-fallback", "read-failed"]);
    expect(session.expectsResponse).toBe(false);
    const next = station.insert(card("SIAC", 2));
    for (const frame of next) { const output = session.receive(frame); events.push(...output.events); pump(output.send); }
    expect(events.at(-1)).toMatchObject({ type: "card-read", readMode: "fast" });
  });

  it("brickan tas ur mellan blocken: misslyckad avläsning, inga påhittade stämplingar", () => {
    const run = read((station) => station.insert(spec), { singleBlockFault: { block: 5, answer: "remove" } });
    expect(run.events.map((event) => event.type)).toEqual(["station-ready", "card-inserted", "read-failed", "card-removed"]);
    expect(run.events[2]).toMatchObject({ reason: "removed", cardNumber: NUMBERS.SIAC });
    // Togs brickan ur när allt som behövs redan kommit (SIAC utan stämplingar, före block 1), är avläsningen hel.
    const complete = read((station) => station.insert(card("SIAC", 0)), { singleBlockFault: { block: 1, answer: "remove" } });
    expect(cardRead(complete).card).toMatchObject({ cardNumber: NUMBERS.SIAC, punches: [] });
  });

  it("sena svar från snabbförsöket blandas inte med \"alla block\"", () => {
    const station = new FakeSiStation({ eightBlocks: true });
    const session = new ReadoutSession();
    const events: ReadoutEvent[] = [];
    const deliver = (frames: readonly Uint8Array[]) => {
      for (const frame of frames) { const output = session.receive(frame); events.push(...output.events); send(output.send); }
    };
    let hold: Uint8Array[] = [];
    let holding = false;
    const send = (commands: readonly Uint8Array[]) => {
      for (const command of commands) {
        const replies = station.receive(command);
        // Svaret på block 4 dröjer tills efter tidsgränsen.
        if (command.length > 4 && command[2] === Command.READ_SI8_PLUS && command[4] === 4) { hold = replies; holding = true; }
        else deliver(replies);
      }
    };
    send(session.start().send);
    const [detection] = station.insert(spec);
    deliver([detection!]);
    expect(holding).toBe(true);
    const output = session.timeout();
    events.push(...output.events);
    // Det sena blocket 4 kommer före stationens svar på "alla block".
    const late = hold;
    const replies = output.send.flatMap((command) => station.receive(command));
    deliver([...late, ...replies]);
    const result = events.find((event) => event.type === "card-read");
    expect(result).toMatchObject({ readMode: "full" });
    expect(result?.type === "card-read" && result.card).toEqual(full().card);
    expect(result?.type === "card-read" && result.frames.length).toBe(9);
  });
});

describe("mätning: byte och svar per bricka (steg 53)", () => {
  /** Byte på tråden för själva utläsningen (efter detekteringen): kommandon ut, svar in. */
  const traffic = (run: Run) => ({
    commands: run.sent.filter((bytes) => bytes.length > 1).length,
    responses: run.replies.length,
    bytes: run.sent.reduce((sum, bytes) => sum + bytes.length, 0) + run.replies.reduce((sum, bytes) => sum + bytes.length, 0)
  });
  it("SIAC med 20 stämplingar: 3 svar i stället för 5 eller 8", () => {
    const spec = card("SIAC", 20);
    expect(traffic(read((station) => station.insert(spec), {}, false))).toEqual({ commands: 1, responses: 5, bytes: 8 + 5 * 137 + 1 });
    expect(traffic(read((station) => station.insert(spec), { eightBlocks: true }, false))).toEqual({ commands: 1, responses: 8, bytes: 8 + 8 * 137 + 1 });
    expect(traffic(read((station) => station.insert(spec)))).toEqual({ commands: 3, responses: 3, bytes: 3 * (8 + 137) + 1 });
    expect(traffic(read((station) => station.insert(card("SI10", 20))))).toEqual({ commands: 2, responses: 2, bytes: 2 * (8 + 137) + 1 });
    expect(traffic(read((station) => station.insert(card("SI6", 20))))).toEqual({ commands: 2, responses: 2, bytes: 2 * (8 + 137) + 1 });
  });
});
