import { Command, MASTER_DIRECT, StationMode, SystemOffset } from "./constants";
import { decodeCardNumber } from "./card-types";
import { encodeCommand, FrameDecoder } from "./frame";
import { decodeStationClock, type StationClock } from "./time";

/**
 * Ägaren 2026-11-08: läsa ut en enhet (kontroll, start, mål) utan SPORTident Config+. Bara läsning: systemdata (serienummer,
 * modell, programversion, kod, läge, batteri), klockan och backupminnet (vilka brickor som stämplat och när). Inget skrivs till
 * enheten. Enheten kopplas till en huvudstation (BSM) som står i läget fjärr ("remote", SET_MASTER_SLAVE 0x53); sessionen
 * ställer tillbaka huvudstationen i direktläge när den är klar.
 *
 * Status `untested`: fälten och backupposternas form är sammanställda ur öppna beskrivningar (systemvärdenas adresser,
 * kommandot GET_BACKUP 0x81 med tre byte adress och längd, poster om åtta byte från adress 0x100) men inte provade mot en
 * riktig enhet. Alla råa ramar sparas, så att avkodningen kan rättas mot en inspelning (docs/sportident.md).
 */
export const STATION_REMOTE = 0x53;
export const BACKUP_START = 0x100;
export const BACKUP_RECORD = 8;
/** Byte per GET_BACKUP (en ram rymmer högst 255 byte data). */
export const BACKUP_CHUNK = 0x80;
/** Högst så många poster läses (de senaste). */
export const MAX_BACKUP_RECORDS = 4000;

export const STATION_MODELS: Readonly<Record<number, string>> = {
  0x8003: "BSF3", 0x8004: "BSF4", 0x8084: "BSM4", 0x8086: "BSM6", 0x8115: "BSF5", 0x8146: "BSF6", 0x8117: "BSF7", 0x8197: "BSF7",
  0x8118: "BSF8", 0x8198: "BSF8", 0x8187: "BS7-Master", 0x8188: "BS8-Master", 0x9197: "BSM7", 0x9198: "BSM8", 0x9597: "BS7-S",
  0xb197: "BS7-P", 0xb198: "BS8-P", 0xb897: "BS7-GSM", 0x9d9a: "BS11-BL", 0xcd9b: "BS11-BS"
};
const MODE_NAMES: Readonly<Record<number, string>> = {
  [StationMode.CONTROL]: "CONTROL", [StationMode.START]: "START", [StationMode.FINISH]: "FINISH", [StationMode.READOUT]: "READOUT",
  [StationMode.CLEAR]: "CLEAR", [StationMode.CHECK]: "CHECK", 0x12: "BEACON_CONTROL", 0x13: "BEACON_START", 0x14: "BEACON_FINISH"
};

export interface StationSystemData {
  readonly serialNumber: number;
  readonly model: string | null;
  readonly modelId: number;
  /** Programversionen som enheten anger den (oftast tre siffror). */
  readonly firmware: string;
  readonly code: number;
  readonly mode: number;
  readonly modeName: string | null;
  readonly extendedProtocol: boolean;
  /** Backupminnets storlek i kB. */
  readonly memoryKb: number;
  /** Datum då batteriet byttes (ÅÅÅÅ-MM-DD), om enheten anger det. */
  readonly batteryDate: string | null;
  /** Batteriets kapacitet som enheten anger den (enheten oklar, se `untested`). */
  readonly batteryCapacityRaw: number;
  /** Systemvärdena 0x34–0x37 (batteriets förbrukning) som hex, tills de är provade. */
  readonly batteryStateHex: string;
  readonly backupPointer: number;
  readonly memoryOverflow: boolean;
  /** Systemvärdet 0x73 (pip, blink och kodens höga bitar), för att skriva koden utan att ändra resten. */
  readonly flags73: number;
}

export interface BackupPunch {
  readonly cardNumber: number;
  /** Sekunder i halvdygnet (0–43 199) eller null om posten saknar tid. */
  readonly secondsIn12h: number | null;
  /** Postens alla åtta byte som hex (byte 3, 4 och 7 är inte avkodade än). */
  readonly rawHex: string;
}

export interface StationReport {
  readonly system: StationSystemData;
  readonly clock: StationClock | null;
  readonly punches: readonly BackupPunch[];
  /** Fler poster fanns än som lästes (de äldsta hoppades över). */
  readonly truncated: boolean;
}

const hex = (bytes: Uint8Array) => [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
const ascii = (bytes: Uint8Array) => [...bytes].every(byte => byte >= 0x20 && byte < 0x7f) ? String.fromCharCode(...bytes) : hex(bytes);

/** Systemdata ur svaret på GET_SYSTEM_VALUE 0x00 0x80 (datadelen: adressen och 0x80 byte). */
export function parseStationSystem(data: Uint8Array): StationSystemData | undefined {
  if (data.length < 1 + 0x80 || data[0] !== 0) return undefined;
  const v = data.subarray(1);
  const at = (offset: number) => v[offset]!;
  const modelId = (at(0x0b) << 8) | at(0x0c);
  const [yy, mm, dd] = [at(0x15), at(0x16), at(0x17)];
  const batteryDate = yy <= 99 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31
    ? `${2000 + yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}` : null;
  const mode = at(SystemOffset.MODE);
  return {
    serialNumber: ((at(0x00) << 24) | (at(0x01) << 16) | (at(0x02) << 8) | at(0x03)) >>> 0,
    model: STATION_MODELS[modelId] ?? null, modelId,
    firmware: ascii(v.subarray(0x05, 0x08)),
    code: at(SystemOffset.STATION_CODE) | (((at(0x73) >> 6) & 0x03) << 8),
    mode, modeName: MODE_NAMES[mode] ?? null,
    extendedProtocol: (at(SystemOffset.PROTOCOL) & 0x01) === 0x01,
    memoryKb: at(0x0d),
    batteryDate,
    batteryCapacityRaw: (at(0x19) << 8) | at(0x1a),
    batteryStateHex: hex(v.subarray(0x34, 0x38)),
    backupPointer: ((at(0x1c) << 24) | (at(0x1d) << 16) | (at(0x21) << 8) | at(0x22)) >>> 0,
    memoryOverflow: at(0x3d) !== 0,
    flags73: at(0x73)
  };
}

/** Backupposterna (åtta byte var) ur en följd av minnesbyte. Tomma poster (0xFF eller 0x00) hoppas över. */
export function parseBackupRecords(bytes: Uint8Array): BackupPunch[] {
  const punches: BackupPunch[] = [];
  for (let at = 0; at + BACKUP_RECORD <= bytes.length; at += BACKUP_RECORD) {
    const record = bytes.subarray(at, at + BACKUP_RECORD);
    if (record.every(byte => byte === 0xff) || record.every(byte => byte === 0x00)) continue;
    const seconds = (record[5]! << 8) | record[6]!;
    punches.push({ cardNumber: decodeCardNumber(record[0]!, record[1]!, record[2]!), secondsIn12h: seconds < 12 * 3600 ? seconds : null,
      rawHex: hex(record) });
  }
  return punches;
}

/** Vilka minnesadresser som ska läsas: de senaste posterna före pekaren, högst `MAX_BACKUP_RECORDS`. */
export function backupRanges(system: Pick<StationSystemData, "backupPointer" | "memoryOverflow" | "memoryKb">)
  : { ranges: { start: number; end: number }[]; truncated: boolean } {
  const top = Math.max(BACKUP_START, system.memoryKb * 1024);
  const pointer = Math.min(Math.max(system.backupPointer, BACKUP_START), top);
  const max = MAX_BACKUP_RECORDS * BACKUP_RECORD;
  const before = pointer - BACKUP_START;
  if (!system.memoryOverflow || top <= BACKUP_START) {
    const start = Math.max(BACKUP_START, pointer - max);
    return { ranges: pointer > start ? [{ start, end: pointer }] : [], truncated: before > max };
  }
  // Minnet har gått runt: de äldsta posterna står efter pekaren.
  const after = top - pointer;
  if (before >= max) return { ranges: [{ start: pointer - max, end: pointer }], truncated: true };
  const fromTop = Math.min(after, max - before);
  return { ranges: [...(fromTop > 0 ? [{ start: top - fromTop, end: top }] : []), ...(before > 0 ? [{ start: BACKUP_START, end: pointer }] : [])],
    truncated: before + after > max };
}

export type StationReadEvent =
  | { readonly type: "no-station" }
  | { readonly type: "progress"; readonly done: number; readonly total: number }
  | { readonly type: "station-read"; readonly report: StationReport }
  | { readonly type: "read-failed"; readonly reason: "timeout" | "nak" | "unexpected" };

export interface StationReadOutput { readonly send: readonly Uint8Array[]; readonly events: readonly StationReadEvent[] }

type State =
  | { readonly name: "idle" }
  | { readonly name: "set-target" }
  | { readonly name: "system" }
  | { readonly name: "clock"; readonly system: StationSystemData }
  | { readonly name: "backup"; readonly system: StationSystemData; readonly clock: StationClock | null; readonly chunks: { start: number; length: number }[];
    index: number; readonly bytes: Uint8Array[]; readonly truncated: boolean }
  | { readonly name: "restore"; readonly report: StationReport | undefined; readonly failure?: "timeout" | "nak" | "unexpected" };

/**
 * Tillståndsmaskin för att läsa ut en enhet (ingen I/O, som `ReadoutSession`). `remote` = enheten som är kopplad till
 * huvudstationen (förval); annars huvudstationen själv. Alla mottagna ramar sparas i `frames`.
 */
export class StationReadSession {
  readonly #decoder = new FrameDecoder();
  #state: State = { name: "idle" };
  readonly #remote: boolean;
  readonly frames: Uint8Array[] = [];

  constructor(options: { remote?: boolean } = {}) { this.#remote = options.remote ?? true; }

  get expectsResponse(): boolean { return this.#state.name !== "idle"; }

  start(): StationReadOutput {
    this.#decoder.flush();
    this.frames.length = 0;
    this.#state = { name: "set-target" };
    return { send: [encodeCommand(Command.SET_MASTER_SLAVE, [this.#remote ? STATION_REMOTE : MASTER_DIRECT])], events: [] };
  }

  receive(chunk: Uint8Array): StationReadOutput {
    const send: Uint8Array[] = [];
    const events: StationReadEvent[] = [];
    for (const event of this.#decoder.push(chunk)) {
      if (event.kind === "frame") { this.frames.push(event.frame.raw); this.#onFrame(event.frame.command, event.frame.data, send, events); }
      else if (event.kind === "nak") this.#fail("nak", send, events);
    }
    return { send, events };
  }

  timeout(): StationReadOutput {
    const send: Uint8Array[] = [];
    const events: StationReadEvent[] = [];
    this.#decoder.flush();
    const state = this.#state;
    if (state.name === "clock") this.#startBackup(state.system, null, send, events);
    else this.#fail("timeout", send, events);
    return { send, events };
  }

  #fail(reason: "timeout" | "nak" | "unexpected", send: Uint8Array[], events: StationReadEvent[]): void {
    const state = this.#state;
    if (state.name === "idle") return;
    if (state.name === "restore") { this.#finish(state, events); return; }
    if (state.name === "set-target" || state.name === "system") {
      // Ingen enhet svarade: huvudstationen tillbaka i direktläge (svaret väntas inte).
      this.#state = { name: "idle" };
      if (this.#remote) send.push(encodeCommand(Command.SET_MASTER_SLAVE, [MASTER_DIRECT]));
      events.push({ type: "no-station" });
      return;
    }
    if (state.name === "clock" && reason === "nak") { this.#startBackup(state.system, null, send, events); return; }
    this.#restore(undefined, reason, send, events);
  }

  #onFrame(command: number, data: Uint8Array, send: Uint8Array[], events: StationReadEvent[]): void {
    const state = this.#state;
    switch (state.name) {
      case "idle": return;
      case "set-target":
        if (command !== Command.SET_MASTER_SLAVE) return;
        this.#state = { name: "system" };
        send.push(encodeCommand(Command.GET_SYSTEM_VALUE, [0x00, 0x80]));
        return;
      case "system": {
        if (command !== Command.GET_SYSTEM_VALUE) return;
        const system = parseStationSystem(data);
        if (!system) { this.#restore(undefined, "unexpected", send, events); return; }
        this.#state = { name: "clock", system };
        send.push(encodeCommand(Command.GET_TIME));
        return;
      }
      case "clock":
        if (command !== Command.GET_TIME) return;
        this.#startBackup(state.system, decodeStationClock(data) ?? null, send, events);
        return;
      case "backup": {
        if (command !== Command.GET_BACKUP) return;
        const chunk = state.chunks[state.index]!;
        const address = (data[0]! << 16) | (data[1]! << 8) | data[2]!;
        // Ett svar som redan kommit (dubblett) hoppas över; ett annat ger fel.
        if (data.length >= 3 && state.chunks.slice(0, state.index).some(done => done.start === address)) return;
        if (data.length < 3 || address !== chunk.start) { this.#restore(undefined, "unexpected", send, events); return; }
        state.bytes.push(data.subarray(3, 3 + chunk.length));
        state.index += 1;
        events.push({ type: "progress", done: state.index, total: state.chunks.length });
        if (state.index < state.chunks.length) { send.push(backupCommand(state.chunks[state.index]!)); return; }
        const all = new Uint8Array(state.bytes.reduce((sum, part) => sum + part.length, 0));
        let offset = 0;
        for (const part of state.bytes) { all.set(part, offset); offset += part.length; }
        this.#restore({ system: state.system, clock: state.clock, punches: parseBackupRecords(all), truncated: state.truncated }, undefined, send, events);
        return;
      }
      case "restore":
        if (command === Command.SET_MASTER_SLAVE) this.#finish(state, events);
        return;
    }
  }

  #startBackup(system: StationSystemData, clock: StationClock | null, send: Uint8Array[], events: StationReadEvent[]): void {
    const { ranges, truncated } = backupRanges(system);
    const chunks: { start: number; length: number }[] = [];
    for (const range of ranges) {
      for (let start = range.start; start < range.end; start += BACKUP_CHUNK) chunks.push({ start, length: Math.min(BACKUP_CHUNK, range.end - start) });
    }
    if (chunks.length === 0) { this.#restore({ system, clock, punches: [], truncated: false }, undefined, send, events); return; }
    this.#state = { name: "backup", system, clock, chunks, index: 0, bytes: [], truncated };
    events.push({ type: "progress", done: 0, total: chunks.length });
    send.push(backupCommand(chunks[0]!));
  }

  /** Huvudstationen tillbaka i direktläge; rapporten (eller felet) lämnas när den svarat (eller tiden gått ut). */
  #restore(report: StationReport | undefined, failure: "timeout" | "nak" | "unexpected" | undefined, send: Uint8Array[], events: StationReadEvent[]): void {
    const state: Extract<State, { name: "restore" }> = { name: "restore", report, ...(failure ? { failure } : {}) };
    if (!this.#remote) { this.#finish(state, events); return; }
    this.#state = state;
    send.push(encodeCommand(Command.SET_MASTER_SLAVE, [MASTER_DIRECT]));
  }

  #finish(state: Extract<State, { name: "restore" }>, events: StationReadEvent[]): void {
    this.#state = { name: "idle" };
    if (state.report) events.push({ type: "station-read", report: state.report });
    else events.push({ type: "read-failed", reason: state.failure ?? "unexpected" });
  }
}

function backupCommand(chunk: { start: number; length: number }): Uint8Array {
  return encodeCommand(Command.GET_BACKUP, [(chunk.start >> 16) & 0xff, (chunk.start >> 8) & 0xff, chunk.start & 0xff, chunk.length]);
}
