import { describe, expect, it } from "vitest";
import {
  ACK,
  FakeSiStation,
  ReadoutSession,
  StationMode,
  type ReadoutEvent,
  type SimulatedCard
} from "../src";

const SAT = 6;
const at = (h: number, m: number, s = 0) => ({ secondsOfDay: h * 3600 + m * 60 + s, dayOfWeek: SAT });
const siac: SimulatedCard = {
  cardType: "SIAC",
  cardNumber: 8_001_234,
  start: at(10, 0),
  finish: at(10, 30),
  punches: [{ code: 31, time: at(10, 10) }, { code: 32, time: at(10, 20) }]
};

/** Kopplar ihop session och falsk station, med valfri chunkstorlek på tråden. */
function wire(station: FakeSiStation, chunkSize = Infinity) {
  const session = new ReadoutSession();
  const events: ReadoutEvent[] = [];
  const written: Uint8Array[] = [];
  const deliver = (bytes: readonly Uint8Array[]): void => {
    for (const frame of bytes) {
      for (let offset = 0; offset < frame.length; offset += Math.min(chunkSize, frame.length)) {
        const output = session.receive(frame.subarray(offset, offset + Math.min(chunkSize, frame.length)));
        events.push(...output.events);
        send(output.send);
      }
    }
  };
  const send = (bytes: readonly Uint8Array[]): void => {
    for (const command of bytes) {
      written.push(command);
      deliver(station.receive(command));
    }
  };
  return {
    session,
    events,
    written,
    start: () => {
      const output = session.start();
      events.push(...output.events);
      send(output.send);
    },
    deliver
  };
}

describe("ReadoutSession", () => {
  it("handskakar, läser en SIAC och kvitterar", () => {
    const station = new FakeSiStation({ stationCode: 10, serialNumber: 501_234 });
    const w = wire(station);
    w.start();
    expect(w.events).toEqual([
      {
        type: "station-ready",
        station: { serialNumber: 501_234, stationCode: 10, mode: StationMode.READOUT, extendedProtocol: true, handshake: true }
      }
    ]);
    w.deliver(station.insert(siac));
    const read = w.events.find((e) => e.type === "card-read");
    expect(read?.type === "card-read" && read.card).toMatchObject({ cardType: "SIAC", cardNumber: 8_001_234 });
    expect(read?.type === "card-read" && read.frames.length).toBe(6); // detektering + 5 block
    expect(w.written.at(-1)).toEqual(Uint8Array.of(ACK));
    expect(w.session.expectsResponse).toBe(false);
  });

  for (const cardType of ["SI5", "SI6", "SI8", "SI9", "SI10", "SI11", "pCard"] as const) {
    const numbers = { SI5: 54_321, SI6: 765_432, SI8: 2_000_123, SI9: 1_000_123, SI10: 7_000_123, SI11: 9_000_123, pCard: 4_000_123 };
    it(`läser ${cardType} byte för byte`, () => {
      const station = new FakeSiStation();
      const w = wire(station, 1);
      w.start();
      w.deliver(station.insert({ ...siac, cardType, cardNumber: numbers[cardType] }));
      const types = w.events.map((e) => e.type);
      expect(types).toEqual(["station-ready", "card-inserted", "card-read"]);
      const read = w.events[2];
      expect(read?.type === "card-read" && read.card.punches.map((p) => p.code)).toEqual([31, 32]);
      expect(read?.type === "card-read" && read.card.cardNumber).toBe(numbers[cardType]);
    });
  }

  it("läser två brickor efter varandra", () => {
    const station = new FakeSiStation();
    const w = wire(station);
    w.start();
    w.deliver(station.insert(siac));
    w.deliver([station.remove()]);
    w.deliver(station.insert({ ...siac, cardNumber: 8_001_235 }));
    const reads = w.events.filter((e) => e.type === "card-read");
    expect(reads.map((e) => e.type === "card-read" && e.card.cardNumber)).toEqual([8_001_234, 8_001_235]);
    expect(w.events.filter((e) => e.type === "card-removed")).toHaveLength(1);
  });

  it("tar emot data utan handskakning", () => {
    const station = new FakeSiStation({ handshake: false });
    const w = wire(station);
    w.start();
    const before = w.written.length;
    w.deliver(station.insert(siac));
    expect(w.events.some((e) => e.type === "card-read")).toBe(true);
    // Inga läskommandon skickades, bara kvittensen.
    expect(w.written.slice(before)).toEqual([Uint8Array.of(ACK)]);
  });

  it("rapporterar fel inställd station", () => {
    const station = new FakeSiStation({ mode: StationMode.CONTROL, extendedProtocol: false });
    const w = wire(station);
    w.start();
    expect(w.events[0]).toMatchObject({ type: "station-misconfigured", problems: ["not-extended-protocol", "not-readout-mode"] });
  });

  it("rapporterar bricka som togs ur mitt i läsningen", () => {
    const station = new FakeSiStation();
    const session = new ReadoutSession();
    const events: ReadoutEvent[] = [];
    for (const command of session.start().send) {
      for (const reply of station.receive(command)) {
        const output = session.receive(reply);
        for (const next of output.send) for (const r of station.receive(next)) events.push(...session.receive(r).events);
      }
    }
    // Detektering, men stationen hinner inte svara innan brickan tas ur.
    const [detection] = station.insert(siac);
    events.push(...session.receive(detection!).events);
    expect(session.expectsResponse).toBe(true);
    events.push(...session.receive(station.remove()).events);
    expect(events.map((e) => e.type)).toEqual(["station-ready", "card-inserted", "read-failed", "card-removed"]);
    expect(events[2]).toMatchObject({ reason: "removed", cardNumber: 8_001_234 });
    expect(session.expectsResponse).toBe(false);
  });

  it("rapporterar tidsgräns under läsning och fortsätter vänta på nästa bricka", () => {
    const station = new FakeSiStation();
    const w = wire(station);
    w.start();
    const [detection] = station.insert(siac);
    w.events.push(...w.session.receive(detection!).events);
    const output = w.session.timeout();
    expect(output.events).toEqual([expect.objectContaining({ type: "read-failed", reason: "timeout" })]);
    w.deliver(station.insert(siac));
    expect(w.events.some((e) => e.type === "card-read")).toBe(true);
  });

  it("rapporterar uteblivet svar vid handskakning", () => {
    const session = new ReadoutSession();
    session.start();
    expect(session.expectsResponse).toBe(true);
    expect(session.timeout().events).toEqual([{ type: "no-response" }]);
    expect(session.expectsResponse).toBe(false);
  });

  it("rapporterar okänd bricktyp", () => {
    const station = new FakeSiStation();
    const w = wire(station);
    w.start();
    // tCard (6 000 000-serien) stöds inte än.
    w.deliver([station.insert({ ...siac, cardNumber: 6_000_001 })[0]!]);
    expect(w.events.at(-1)).toEqual({ type: "card-unsupported", cardNumber: 6_000_001 });
  });
});
