import { describe, expect, it } from "vitest";
import {
  ACK,
  Command,
  encodeStationClock,
  encodeStationFrame,
  FakeSiStation,
  ReadoutSession,
  StationMode,
  type ReadoutEvent,
  type SimulatedCard,
  type StationClock
} from "../src";

const CLOCK: StationClock = { year: 2026, month: 10, day: 3, secondsOfDay: 10 * 3600 + 31 * 60 + 5, milliseconds: 500 };
const clock = () => ({ clock: CLOCK, dayOfWeek: SAT });

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
    const station = new FakeSiStation({ stationCode: 10, serialNumber: 501_234, clock });
    const w = wire(station);
    w.start();
    expect(w.events).toEqual([
      {
        type: "station-ready",
        station: { serialNumber: 501_234, stationCode: 10, mode: StationMode.READOUT, extendedProtocol: true, handshake: true, clock: CLOCK }
      }
    ]);
    // Handskakningen frågar efter stationens klocka (GET_TIME) sist.
    expect(w.written.slice(0, 3).map((bytes) => bytes[2])).toEqual([Command.SET_MASTER_SLAVE, Command.GET_SYSTEM_VALUE, Command.GET_TIME]);
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
    const pump = (bytes: readonly Uint8Array[]): void => {
      for (const command of bytes) for (const reply of station.receive(command)) {
        const output = session.receive(reply);
        events.push(...output.events);
        pump(output.send);
      }
    };
    pump(session.start().send);
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

  // PLAN.md steg 22: stationens klocka och brickor som sitter i före handskakningen.
  it("fortsätter utan stationsklocka när stationen svarar NAK eller inte alls på GET_TIME", () => {
    const naks = new FakeSiStation({ clock: null });
    const w = wire(naks);
    w.start();
    expect(w.events).toEqual([expect.objectContaining({ type: "station-ready" })]);
    expect("clock" in (w.events[0] as { station: object }).station).toBe(false);
    w.deliver(naks.insert(siac));
    expect(w.events.some((e) => e.type === "card-read")).toBe(true);

    const silent = new ReadoutSession();
    const station = new FakeSiStation();
    let output = silent.start();
    for (let round = 0; round < 2; round += 1) {
      const [command] = output.send;
      output = silent.receive(station.receive(command!)[0]!);
    }
    // GET_TIME är skickat men inget svar kommer.
    expect(output.send[0]?.[2]).toBe(Command.GET_TIME);
    expect(silent.expectsResponse).toBe(true);
    const timedOut = silent.timeout();
    expect(timedOut.events).toEqual([expect.objectContaining({ type: "station-ready" })]);
    expect(silent.station?.clock).toBeUndefined();
    expect(silent.expectsResponse).toBe(false);
  });

  it("tolkar GET_TIME byte för byte och förkastar fel kontrollsumma", () => {
    const station = new FakeSiStation({ clock });
    const w = wire(station, 1);
    w.start();
    expect(w.session.station?.clock).toEqual(CLOCK);

    // Samma svar med förstörd kontrollsumma: ramen kastas, stationen svarar inte och tidsgränsen löper ut.
    const broken = new ReadoutSession();
    let output = broken.start();
    for (let round = 0; round < 2; round += 1) output = broken.receive(station.receive(output.send[0]!)[0]!);
    const reply = encodeStationFrame(Command.GET_TIME, 10, encodeStationClock(CLOCK, SAT));
    reply[reply.length - 2] = (reply[reply.length - 2]! ^ 0xff) & 0xff;
    const bad = broken.receive(reply);
    expect(bad.events).toEqual([expect.objectContaining({ type: "frame-error", reason: "crc" })]);
    expect(broken.expectsResponse).toBe(true);
    expect(broken.timeout().events).toEqual([expect.objectContaining({ type: "station-ready" })]);
    expect(broken.station?.clock).toBeUndefined();

    // Ett för kort GET_TIME-svar ger en station utan klocka.
    const short = new ReadoutSession();
    output = short.start();
    for (let round = 0; round < 2; round += 1) output = short.receive(station.receive(output.send[0]!)[0]!);
    expect(short.receive(encodeStationFrame(Command.GET_TIME, 10, [26, 10, 3])).events)
      .toEqual([expect.objectContaining({ type: "station-ready" })]);
    expect(short.station?.clock).toBeUndefined();
  });

  it("läser en bricka som sitter i stationen när handskakningen börjar", () => {
    const station = new FakeSiStation();
    const session = new ReadoutSession();
    const events: ReadoutEvent[] = [];
    const [detection] = station.insert(siac);
    // Detekteringsramen kommer innan stationen har svarat på SET_MASTER_SLAVE.
    const output = session.start();
    events.push(...session.receive(detection!).events);
    expect(events).toEqual([]);
    const pump = (bytes: readonly Uint8Array[]): void => {
      for (const command of bytes) for (const reply of station.receive(command)) {
        const next = session.receive(reply);
        events.push(...next.events);
        pump(next.send);
      }
    };
    pump(output.send);
    expect(events.map((e) => e.type)).toEqual(["station-ready", "card-inserted", "card-read"]);

    // Togs brickan ur innan handskakningen var klar läses inget.
    const removedStation = new FakeSiStation();
    const removedSession = new ReadoutSession();
    const removedEvents: ReadoutEvent[] = [];
    const start = removedSession.start();
    removedEvents.push(...removedSession.receive(removedStation.insert(siac)[0]!).events);
    removedEvents.push(...removedSession.receive(removedStation.remove()).events);
    let pendingSend = start.send;
    while (pendingSend.length > 0) {
      const [command] = pendingSend;
      const next = removedSession.receive(removedStation.receive(command!)[0]!);
      removedEvents.push(...next.events);
      pendingSend = next.send;
    }
    expect(removedEvents.map((e) => e.type)).toEqual(["station-ready"]);
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
