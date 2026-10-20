import { describe, expect, it } from "vitest";
import { Command, encodeStationFrame, FakeSiStation, ReadoutSession, type ReadoutEvent, type SimulatedCard } from "../src";
import { NATT_KM_CARD, NATT_KM_CODES, NATT_KM_STATION, nattKmBlockFrame, nattKmDetection } from "./fixtures/siac-natt-km";

/**
 * Natt-KM 2026-10-20: en BSM8 inställd på att skicka alla åtta block skickade block 0–7 för SIAC. O-Tid tog de fem
 * första som om de vore 0, 4, 5, 6, 7 och läste block 1 (brickans inställningar) som stämplingar: felstämplat och
 * "gamla stämplingar". Blocken (`fixtures/siac-natt-km.ts`) är den riktiga brickans (bricknumret utbytt), avlästa i efterhand.
 */
const STATION = NATT_KM_STATION;
const CARD = NATT_KM_CARD;
const detection = nattKmDetection();
const blockFrame = (number: number) => nattKmBlockFrame(number);

function readySession() {
  const station = new FakeSiStation({ stationCode: STATION });
  const session = new ReadoutSession();
  const pump = (bytes: readonly Uint8Array[]): void => {
    for (const command of bytes) for (const reply of station.receive(command)) pump(session.receive(reply).send);
  };
  pump(session.start().send);
  return session;
}

const EXPECTED_CODES = NATT_KM_CODES;

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
