/**
 * Ägaren 2026-11-08: ställa in en enhet (klocka, kod, läge; status `untested`). En falsk enhet med systemminne tar emot
 * SET_TIME och SET_SYSTEM_VALUE; efteråt läses värdena igen. Prövas med chunkgränser, en enhet som inte tar emot ändringen,
 * NAK och tystnad.
 */
import { describe, expect, it } from "vitest";
import {
  Command, decodeStationClock, encodeStationFrame, FrameDecoder, MASTER_DIRECT, StationMode, StationWriteSession, validWritePlan,
  type StationWriteEvent, type StationWritePlan
} from "../src";
import { encodeStationClock } from "../src/time";

function fakeUnit(options: { ignoreWrites?: boolean; nakTime?: boolean; silent?: boolean } = {}) {
  const system = new Uint8Array(0x80);
  system.set([0x00, 0x03, 0x0f, 0x42], 0x00);
  system.set([0x81, 0x98], 0x0b);
  system[0x0d] = 128; system[0x71] = StationMode.CONTROL; system[0x72] = 31; system[0x73] = 0b0000_0101; system[0x74] = 0x01;
  system.set([0, 0, 1, 0], 0x1c);
  let clock = encodeStationClock({ year: 2026, month: 1, day: 1, secondsOfDay: 3600, milliseconds: 0 }, 4);
  const decoder = new FrameDecoder({ stationFrames: false });
  const seen: number[] = [];
  return { system, seen, clock: () => clock, reply(bytes: Uint8Array): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (const event of decoder.push(bytes)) {
      if (event.kind !== "frame") continue;
      const { command, data } = event.frame;
      seen.push(command);
      if (options.silent && !(command === Command.SET_MASTER_SLAVE && data[0] === MASTER_DIRECT)) continue;
      if (command === Command.SET_MASTER_SLAVE) out.push(encodeStationFrame(command, 31, [data[0]!]));
      else if (command === Command.GET_SYSTEM_VALUE) out.push(encodeStationFrame(command, 31, [0x00, ...system]));
      else if (command === Command.GET_TIME) out.push(encodeStationFrame(command, 31, clock));
      else if (command === Command.SET_TIME) {
        if (options.nakTime) { out.push(Uint8Array.of(0x15)); continue; }
        clock = [...data]; out.push(encodeStationFrame(command, 31, [...data]));
      } else if (command === Command.SET_SYSTEM_VALUE) {
        if (!options.ignoreWrites) system.set(data.subarray(1), data[0]);
        out.push(encodeStationFrame(command, 31, [data[0]!]));
      }
    }
    return out;
  } };
}

function run(session: StationWriteSession, unit: ReturnType<typeof fakeUnit>, chunk = Infinity) {
  const events: StationWriteEvent[] = [];
  const started = session.start();
  events.push(...started.events);
  let queue = [...started.send];
  for (let guard = 0; guard < 100 && queue.length > 0; guard += 1) {
    const next: Uint8Array[] = [];
    for (const command of queue) {
      for (const reply of unit.reply(command)) {
        for (let at = 0; at < reply.length; at += Math.min(chunk, reply.length)) {
          const out = session.receive(reply.subarray(at, at + Math.min(chunk, reply.length)));
          events.push(...out.events); next.push(...out.send);
        }
      }
    }
    if (next.length === 0 && session.expectsResponse) { const out = session.timeout(); events.push(...out.events); next.push(...out.send); }
    queue = next;
  }
  return events;
}

const TIME = { clock: { year: 2026, month: 11, day: 8, secondsOfDay: 21 * 3600 + 30 * 60, milliseconds: 0 }, dayOfWeek: 0 };

describe("ställa in en enhet", () => {
  it("klocka, kod (också över 255, övriga bitar i 0x73 kvar) och läge; läses igen efteråt", () => {
    for (const chunk of [Infinity, 1, 9]) {
      const unit = fakeUnit();
      const events = run(new StationWriteSession({ time: TIME, code: 300, mode: StationMode.START }), unit, chunk);
      const done = events.find(event => event.type === "station-written");
      if (done?.type !== "station-written") throw new Error(JSON.stringify(events));
      expect(done.report).toMatchObject({ codeOk: true, modeOk: true, before: { code: 31, mode: StationMode.CONTROL }, after: { code: 300, mode: StationMode.START } });
      expect(unit.system[0x73]! & 0x3f).toBe(0b0000_0101);
      expect(done.report.clockAfter).toMatchObject({ year: 2026, month: 11, day: 8, secondsOfDay: 21 * 3600 + 30 * 60 });
      expect(decodeStationClock(Uint8Array.from(unit.clock()))?.secondsOfDay).toBe(21 * 3600 + 30 * 60);
      expect(unit.seen).toEqual([Command.SET_MASTER_SLAVE, Command.GET_SYSTEM_VALUE, Command.SET_TIME, Command.SET_SYSTEM_VALUE,
        Command.GET_SYSTEM_VALUE, Command.GET_TIME, Command.SET_MASTER_SLAVE]);
    }
  });

  it("bara klockan: inget systemvärde skrivs", () => {
    const unit = fakeUnit();
    const events = run(new StationWriteSession({ time: TIME }), unit);
    expect(events.at(-1)).toMatchObject({ type: "station-written", report: { codeOk: true, modeOk: true } });
    expect(unit.seen).not.toContain(Command.SET_SYSTEM_VALUE);
  });

  it("en enhet som inte tar emot ändringen, NAK och tystnad", () => {
    const ignoring = run(new StationWriteSession({ code: 45 }), fakeUnit({ ignoreWrites: true }));
    expect(ignoring.at(-1)).toMatchObject({ type: "station-written", report: { codeOk: false, after: { code: 31 } } });
    const nak = fakeUnit({ nakTime: true });
    expect(run(new StationWriteSession({ time: TIME, code: 45 }), nak).at(-1)).toMatchObject({ type: "write-failed", reason: "nak", before: { code: 31 } });
    expect(nak.seen).not.toContain(Command.SET_SYSTEM_VALUE);
    expect(nak.seen.at(-1)).toBe(Command.SET_MASTER_SLAVE);
    const silent = fakeUnit({ silent: true });
    expect(run(new StationWriteSession({ code: 45 }), silent).map(event => event.type)).toEqual(["no-station"]);
  });

  it("planen prövas först", () => {
    const plans: StationWritePlan[] = [{}, { code: 0 }, { code: 512 }, { code: 3.5 }, { mode: StationMode.READOUT as never }];
    for (const plan of plans) expect(validWritePlan(plan)).toBe(false);
    expect(run(new StationWriteSession({ code: 0 }), fakeUnit())).toEqual([{ type: "write-failed", reason: "invalid-plan" }]);
  });
});
