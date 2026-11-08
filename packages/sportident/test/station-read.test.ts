/**
 * Ägaren 2026-11-08: utläsning av en enhet (bara läsning, status `untested`). En falsk enhet svarar på samma kommandon:
 * fjärrläget, systemdata, klockan och backupminnet i bitar. Prövas med godtyckliga chunkgränser, fel CRC, dubbla ramar,
 * avbrott, NAK och en enhet som inte svarar.
 */
import { describe, expect, it } from "vitest";
import {
  backupRanges, Command, encodeStationFrame, FrameDecoder, MASTER_DIRECT, parseBackupRecords, parseStationSystem, StationReadSession,
  type StationReadEvent
} from "../src";
import { encodeStationClock } from "../src/time";

const CODE = 47;
function systemData(options: { pointer: number; overflow?: boolean; memoryKb?: number }): number[] {
  const v = new Array<number>(0x80).fill(0);
  [v[0x00], v[0x01], v[0x02], v[0x03]] = [0x00, 0x03, 0x0f, 0x42]; // 200 514
  [v[0x05], v[0x06], v[0x07]] = [0x36, 0x35, 0x36]; // "656"
  [v[0x0b], v[0x0c]] = [0x81, 0x98]; // BSF8
  v[0x0d] = options.memoryKb ?? 128;
  [v[0x15], v[0x16], v[0x17]] = [21, 4, 12];
  [v[0x19], v[0x1a]] = [0x00, 0x47];
  [v[0x1c], v[0x1d], v[0x21], v[0x22]] = [0, 0, (options.pointer >> 8) & 0xff, options.pointer & 0xff];
  v[0x3d] = options.overflow ? 1 : 0;
  v[0x71] = 0x02; v[0x72] = CODE; v[0x74] = 0x01;
  return [0x00, ...v];
}
/** SI5: serien i första byten, numret i de två andra. */
const si5Record = (series: number, number: number, seconds: number) => [series, (number >> 8) & 0xff, number & 0xff, 0, 0, (seconds >> 8) & 0xff, seconds & 0xff, 0];
const record = (card: number, seconds: number) => [(card >> 16) & 0xff, (card >> 8) & 0xff, card & 0xff, 0x00, 0x00, (seconds >> 8) & 0xff, seconds & 0xff, 0x00];

/** En falsk enhet med backupposterna `records` från 0x100. */
function fakeStation(records: number[][], options: { overflow?: boolean; silent?: boolean; nakBackup?: boolean } = {}) {
  const memory = new Uint8Array(128 * 1024).fill(0xff);
  records.forEach((bytes, index) => memory.set(bytes, 0x100 + index * 8));
  const pointer = 0x100 + records.length * 8;
  const decoder = new FrameDecoder({ stationFrames: false });
  const seen: number[] = [];
  return { seen, reply(bytes: Uint8Array): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (const event of decoder.push(bytes)) {
      if (event.kind !== "frame") continue;
      const { command, data } = event.frame;
      seen.push(command);
      if (options.silent && !(command === Command.SET_MASTER_SLAVE && data[0] === MASTER_DIRECT)) continue;
      if (command === Command.SET_MASTER_SLAVE) out.push(encodeStationFrame(command, CODE, [data[0]!]));
      else if (command === Command.GET_SYSTEM_VALUE) out.push(encodeStationFrame(command, CODE, systemData({ pointer, ...(options.overflow ? { overflow: true } : {}) })));
      else if (command === Command.GET_TIME) out.push(encodeStationFrame(command, CODE, encodeStationClock({ year: 2026, month: 11, day: 8, secondsOfDay: 13 * 3600, milliseconds: 0 }, 0)));
      else if (command === Command.GET_BACKUP) {
        if (options.nakBackup) { out.push(Uint8Array.of(0x15)); continue; }
        const start = (data[0]! << 16) | (data[1]! << 8) | data[2]!;
        out.push(encodeStationFrame(command, CODE, [data[0]!, data[1]!, data[2]!, ...memory.subarray(start, start + data[3]!)]));
      }
    }
    return out;
  } };
}

function run(session: StationReadSession, station: ReturnType<typeof fakeStation>, chunkSize = Infinity, mangle?: (frame: Uint8Array, index: number) => Uint8Array[]) {
  const events: StationReadEvent[] = [];
  let queue = [...session.start().send];
  let frameIndex = 0;
  for (let guard = 0; guard < 2000 && queue.length > 0; guard += 1) {
    const next: Uint8Array[] = [];
    for (const command of queue) {
      const replies = station.reply(command);
      if (replies.length === 0) { const out = session.timeout(); events.push(...out.events); next.push(...out.send); continue; }
      for (const reply of replies) {
        for (const frame of mangle ? mangle(reply, frameIndex++) : [reply]) {
          for (let at = 0; at < frame.length; at += Math.min(chunkSize, frame.length)) {
            const out = session.receive(frame.subarray(at, at + Math.min(chunkSize, frame.length)));
            events.push(...out.events); next.push(...out.send);
          }
        }
      }
    }
    // Inget svar som gick ihop (avbruten ram): värdens tidsgräns.
    if (next.length === 0 && session.expectsResponse) { const out = session.timeout(); events.push(...out.events); next.push(...out.send); }
    queue = next;
  }
  return events;
}

describe("utläsning av en enhet", () => {
  it("systemdata, klockan och backupminnet; huvudstationen tillbaka i direktläge", () => {
    const records = Array.from({ length: 40 }, (_, i) => i === 3 ? si5Record(2, 23_456, 3690) : record(2_000_000 + i, 3600 + i * 30));
    for (const chunk of [Infinity, 1, 7, 64]) {
      const station = fakeStation(records);
      const session = new StationReadSession();
      const events = run(session, station, chunk);
      const done = events.find(event => event.type === "station-read");
      if (done?.type !== "station-read") throw new Error(`ingen rapport (${chunk})`);
      const { system, clock, punches, truncated } = done.report;
      expect(system).toMatchObject({ serialNumber: 200_514, model: "BSF8", firmware: "656", code: CODE, modeName: "CONTROL", extendedProtocol: true,
        memoryKb: 128, batteryDate: "2021-04-12", backupPointer: 0x100 + 40 * 8, memoryOverflow: false });
      expect(clock).toMatchObject({ year: 2026, month: 11, day: 8, secondsOfDay: 13 * 3600 });
      expect(truncated).toBe(false);
      expect(punches).toHaveLength(40);
      expect(punches[3]).toMatchObject({ cardNumber: 223_456, secondsIn12h: 3690 });
      expect(punches[39]).toMatchObject({ cardNumber: 2_000_039, secondsIn12h: 3600 + 39 * 30 });
      // Fjärrläge först, direktläge sist; 320 byte i tre bitar.
      expect(station.seen[0]).toBe(Command.SET_MASTER_SLAVE);
      expect(station.seen.at(-1)).toBe(Command.SET_MASTER_SLAVE);
      expect(station.seen.filter(command => command === Command.GET_BACKUP)).toHaveLength(3);
      expect(session.expectsResponse).toBe(false);
      expect(events.filter(event => event.type === "progress").at(-1)).toEqual({ type: "progress", done: 3, total: 3 });
    }
  });

  it("dubbla ramar och fel CRC stör inte; en enhet som inte svarar ger no-station", () => {
    const records = Array.from({ length: 20 }, (_, i) => record(500_000 + i, i));
    const doubled = run(new StationReadSession(), fakeStation(records), 5, frame => [frame, frame]);
    const report = doubled.find(event => event.type === "station-read");
    expect(report?.type === "station-read" && report.report.punches.length).toBe(20);
    const broken = run(new StationReadSession(), fakeStation(records), Infinity, (frame, index) => {
      if (index !== 1) return [frame];
      const copy = Uint8Array.from(frame); copy[5] = copy[5]! ^ 0xff; return [copy];
    });
    expect(broken.map(event => event.type)).toContain("no-station");
    const silent = fakeStation(records, { silent: true });
    expect(run(new StationReadSession(), silent).map(event => event.type)).toEqual(["no-station"]);
    expect(silent.seen.at(-1)).toBe(Command.SET_MASTER_SLAVE);
  });

  it("NAK eller avbrott i backupen ger read-failed efter direktläget", () => {
    const records = Array.from({ length: 5 }, (_, i) => record(1_000_000 + i, i));
    expect(run(new StationReadSession(), fakeStation(records, { nakBackup: true })).at(-1)).toEqual({ type: "read-failed", reason: "nak" });
    const truncated = run(new StationReadSession(), fakeStation(records), Infinity, (frame, index) => index === 3 ? [frame.subarray(0, 20)] : [frame]);
    expect(truncated.at(-1)?.type).toBe("read-failed");
  });

  it("minnet som gått runt och för många poster: de senaste läses", () => {
    expect(backupRanges({ backupPointer: 0x100 + 80, memoryOverflow: false, memoryKb: 128 })).toEqual({ ranges: [{ start: 0x100, end: 0x150 }], truncated: false });
    expect(backupRanges({ backupPointer: 0x100 + 80, memoryOverflow: true, memoryKb: 64 })).toEqual({
      ranges: [{ start: 64 * 1024 - (4000 * 8 - 80), end: 64 * 1024 }, { start: 0x100, end: 0x150 }], truncated: true });
    expect(backupRanges({ backupPointer: 0x100, memoryOverflow: false, memoryKb: 128 })).toEqual({ ranges: [], truncated: false });
    expect(parseBackupRecords(Uint8Array.from([...record(7_000_001, 50_000), ...new Array<number>(8).fill(0xff)]))).toEqual([
      { cardNumber: 7_000_001, secondsIn12h: null, rawHex: "6acfc10000c35000" }]);
    expect(parseStationSystem(Uint8Array.of(0x00, 1, 2))).toBeUndefined();
  });
});
