import { describe, expect, it } from "vitest";
import { Command, encodeStationFrame, FakeSiStation, ReadoutSession, type ReadoutEvent, type SimulatedCard } from "../src";

/**
 * Natt-KM 2026-10-20: en BSM8 inställd på att skicka alla åtta block skickade block 0–7 för SIAC. O-Tid tog de fem
 * första som om de vore 0, 4, 5, 6, 7 och läste block 1 (brickans inställningar) som stämplingar: felstämplat och
 * "gamla stämplingar". Blocken nedan är den riktiga brickans (bricknumret utbytt), avlästa i efterhand.
 */
const STATION = 0x1a;
const CARD = 8_001_234;
const hex = (value: string) => Uint8Array.from(value.match(/../g)!.map((pair) => parseInt(pair, 16)));
const block = (runs: readonly [offset: number, data: string][]) => {
  const bytes = new Uint8Array(128).fill(0xee);
  for (const [offset, data] of runs) bytes.set(hex(data), offset);
  return bytes;
};
const cardBytes = [(CARD >> 16) & 0xff, (CARD >> 8) & 0xff, CARD & 0xff];
const realBlocks: Record<number, Uint8Array> = {
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
const detection = encodeStationFrame(Command.SI8_PLUS_DETECTED, STATION, [0x0f, ...cardBytes]);
const blockFrame = (number: number) => encodeStationFrame(Command.READ_SI8_PLUS, STATION, [number, ...realBlocks[number]!]);

function readySession() {
  const station = new FakeSiStation({ stationCode: STATION });
  const session = new ReadoutSession();
  const pump = (bytes: readonly Uint8Array[]): void => {
    for (const command of bytes) for (const reply of station.receive(command)) pump(session.receive(reply).send);
  };
  pump(session.start().send);
  return session;
}

const EXPECTED_CODES = [31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 52, 43];

describe("SIAC från en station som skickar alla åtta block (natt-KM 2026-10-20)", () => {
  it("läser kvällens 14 stämplingar, start, mål och check – inte brickans inställningar", () => {
    const session = readySession();
    const events: ReadoutEvent[] = [];
    const sent: Uint8Array[] = [];
    for (const frame of [detection, ...[0, 1, 2, 3, 4, 5, 6, 7].map(blockFrame)]) {
      const output = session.receive(frame);
      events.push(...output.events);
      sent.push(...output.send);
    }
    const read = events.find((event) => event.type === "card-read");
    if (read?.type !== "card-read") throw new Error(JSON.stringify(events.map((event) => event.type)));
    expect(read.card.cardNumber).toBe(CARD);
    expect(read.card.punches.map((punch) => punch.code)).toEqual(EXPECTED_CODES);
    // 31 kl. 18:50:12 (tisdag eftermiddag), 43 kl. 19:39:39.
    expect(read.card.punches[0]?.time).toEqual({ secondsIn12h: 0x6024, pm: true, dayOfWeek: 2 });
    expect(read.card.punches.at(-1)?.time).toEqual({ secondsIn12h: 0x6bbb, pm: true, dayOfWeek: 2 });
    expect(read.card.start?.time).toEqual({ secondsIn12h: 0x5f9c, pm: true, dayOfWeek: 2 });
    expect(read.card.finish?.time).toEqual({ secondsIn12h: 0x6c1f, pm: true, dayOfWeek: 2 });
    expect(read.card.check?.time).toEqual({ secondsIn12h: 0x5b7f, pm: true, dayOfWeek: 2 });
    // Kvittensen först när sista blocket kommit, inte efter fem block.
    expect(events.filter((event) => event.type === "card-read")).toHaveLength(1);
    expect(sent.at(-1)).toEqual(Uint8Array.of(0x06));
  });

  it("brickan tas ur efter stämplingsblocket men före block 7: avläsningen är ändå hel", () => {
    const session = readySession();
    const events: ReadoutEvent[] = [];
    for (const frame of [detection, ...[0, 1, 2, 3, 4, 5].map(blockFrame),
      encodeStationFrame(Command.CARD_REMOVED, STATION, [0, 0, 0, 0])]) events.push(...session.receive(frame).events);
    const read = events.find((event) => event.type === "card-read");
    expect(read?.type === "card-read" && read.card.punches.map((punch) => punch.code)).toEqual(EXPECTED_CODES);
    expect(events.at(-1)).toEqual({ type: "card-removed" });
  });

  it("brickan tas ur innan stämplingarna kommit: misslyckad avläsning, inga påhittade stämplingar", () => {
    const session = readySession();
    const events: ReadoutEvent[] = [];
    for (const frame of [detection, ...[0, 1, 2].map(blockFrame),
      encodeStationFrame(Command.CARD_REMOVED, STATION, [0, 0, 0, 0])]) events.push(...session.receive(frame).events);
    expect(events.map((event) => event.type)).toEqual(["card-inserted", "read-failed", "card-removed"]);
  });

  for (const cardType of ["SIAC", "SI10", "SI11", "SI6"] as const) {
    it(`${cardType}: samma resultat oavsett om stationen skickar dataklocken eller alla åtta`, () => {
      const at = (minute: number) => ({ secondsOfDay: 19 * 3600 + minute * 60, dayOfWeek: 2 });
      const numbers = { SIAC: 8_001_234, SI10: 7_000_123, SI11: 9_000_123, SI6: 765_432 };
      const card: SimulatedCard = { cardType, cardNumber: numbers[cardType], start: at(0), finish: at(40),
        punches: Array.from({ length: 40 }, (_value, index) => ({ code: 31 + index, time: at(1 + (index % 38)) })) };
      const codes = (eightBlocks: boolean) => {
        const station = new FakeSiStation({ eightBlocks });
        const session = new ReadoutSession();
        const events: ReadoutEvent[] = [];
        const pump = (bytes: readonly Uint8Array[]): void => {
          for (const command of bytes) for (const reply of station.receive(command)) {
            const output = session.receive(reply);
            events.push(...output.events);
            pump(output.send);
          }
        };
        pump(session.start().send);
        for (const frame of station.insert(card)) {
          const output = session.receive(frame);
          events.push(...output.events);
          pump(output.send);
        }
        const read = events.find((event) => event.type === "card-read");
        return read?.type === "card-read" ? read.card.punches.map((punch) => punch.code) : events.map((event) => event.type);
      };
      expect(codes(true)).toEqual(card.punches.map((punch) => punch.code));
      expect(codes(false)).toEqual(card.punches.map((punch) => punch.code));
    });
  }
});
