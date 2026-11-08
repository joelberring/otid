import { Command, MASTER_DIRECT, StationMode, SystemOffset } from "./constants";
import { encodeCommand, FrameDecoder } from "./frame";
import { parseStationSystem, STATION_REMOTE, type StationSystemData } from "./station-read";
import { decodeStationClock, encodeStationClock, type StationClock } from "./time";

/**
 * Ägaren 2026-11-08: ställa in en enhet före tävlingen utan Config+: klockan, koden och läget. Inget annat skrivs. Efter
 * skrivningen läses systemdata och klockan igen, så att det syns om enheten tog emot ändringen. Som `StationReadSession`
 * pratar sessionen med enheten som ligger mot huvudstationen (fjärr) och ställer tillbaka huvudstationen i direktläge.
 *
 * Status `untested`: SET_TIME (0xF6) med samma sju byte som GET_TIME-svaret och SET_SYSTEM_VALUE (0x82) med adress och
 * värden (läget 0x71, koden 0x72 och kodens två höga bitar i 0x73 där övriga bitar behålls) är sammanställda ur öppna
 * beskrivningar men inte provade mot en riktig enhet.
 */
export const WRITABLE_MODES = [StationMode.CONTROL, StationMode.START, StationMode.FINISH, StationMode.CLEAR, StationMode.CHECK] as const;
export const MAX_STATION_CODE = 511;

export interface StationWritePlan {
  /** Klockan att ställa (lokal tid) och veckodagen (0 = söndag). */
  readonly time?: { readonly clock: StationClock; readonly dayOfWeek: number } | undefined;
  readonly code?: number | undefined;
  readonly mode?: (typeof WRITABLE_MODES)[number] | undefined;
}

export interface StationWriteReport {
  readonly before: StationSystemData;
  readonly after: StationSystemData;
  readonly clockAfter: StationClock | null;
  /** Koden och läget är som planen sa (sant när de inte skulle ändras). */
  readonly codeOk: boolean;
  readonly modeOk: boolean;
}

export type StationWriteEvent =
  | { readonly type: "no-station" }
  | { readonly type: "station-written"; readonly report: StationWriteReport }
  | { readonly type: "write-failed"; readonly reason: "timeout" | "nak" | "unexpected" | "invalid-plan"; readonly before?: StationSystemData | undefined };

export interface StationWriteOutput { readonly send: readonly Uint8Array[]; readonly events: readonly StationWriteEvent[] }

type Step = "set-time" | "set-config" | "read-after" | "read-clock";
type State =
  | { readonly name: "idle" }
  | { readonly name: "set-target" }
  | { readonly name: "read-before" }
  | { readonly name: "writing"; readonly step: Step; readonly before: StationSystemData; after?: StationSystemData; readonly steps: readonly Step[] }
  | { readonly name: "restore"; readonly event: StationWriteEvent };

export function validWritePlan(plan: StationWritePlan): boolean {
  if (plan.code !== undefined && (!Number.isInteger(plan.code) || plan.code < 1 || plan.code > MAX_STATION_CODE)) return false;
  if (plan.mode !== undefined && !(WRITABLE_MODES as readonly number[]).includes(plan.mode)) return false;
  return plan.time !== undefined || plan.code !== undefined || plan.mode !== undefined;
}

export class StationWriteSession {
  readonly #decoder = new FrameDecoder();
  #state: State = { name: "idle" };
  readonly #plan: StationWritePlan;
  readonly #remote: boolean;
  readonly frames: Uint8Array[] = [];

  constructor(plan: StationWritePlan, options: { remote?: boolean } = {}) { this.#plan = plan; this.#remote = options.remote ?? true; }

  get expectsResponse(): boolean { return this.#state.name !== "idle"; }

  start(): StationWriteOutput {
    if (!validWritePlan(this.#plan)) return { send: [], events: [{ type: "write-failed", reason: "invalid-plan" }] };
    this.#decoder.flush();
    this.frames.length = 0;
    this.#state = { name: "set-target" };
    return { send: [encodeCommand(Command.SET_MASTER_SLAVE, [this.#remote ? STATION_REMOTE : MASTER_DIRECT])], events: [] };
  }

  receive(chunk: Uint8Array): StationWriteOutput {
    const send: Uint8Array[] = [];
    const events: StationWriteEvent[] = [];
    for (const event of this.#decoder.push(chunk)) {
      if (event.kind === "frame") { this.frames.push(event.frame.raw); this.#onFrame(event.frame.command, event.frame.data, send, events); }
      else if (event.kind === "nak") this.#fail("nak", send, events);
    }
    return { send, events };
  }

  timeout(): StationWriteOutput {
    const send: Uint8Array[] = [];
    const events: StationWriteEvent[] = [];
    this.#decoder.flush();
    const state = this.#state;
    // Klockan efteråt är bara en kontroll: utan svar blir rapporten utan den.
    if (state.name === "writing" && state.step === "read-clock" && state.after) this.#done(state.before, state.after, null, send, events);
    else this.#fail("timeout", send, events);
    return { send, events };
  }

  #fail(reason: "timeout" | "nak" | "unexpected", send: Uint8Array[], events: StationWriteEvent[]): void {
    const state = this.#state;
    if (state.name === "idle") return;
    if (state.name === "restore") { this.#state = { name: "idle" }; events.push(state.event); return; }
    if (state.name === "set-target" || state.name === "read-before") {
      this.#state = { name: "idle" };
      if (this.#remote) send.push(encodeCommand(Command.SET_MASTER_SLAVE, [MASTER_DIRECT]));
      events.push({ type: "no-station" });
      return;
    }
    this.#restore({ type: "write-failed", reason, before: state.before }, send, events);
  }

  #onFrame(command: number, data: Uint8Array, send: Uint8Array[], events: StationWriteEvent[]): void {
    const state = this.#state;
    switch (state.name) {
      case "idle": return;
      case "set-target":
        if (command !== Command.SET_MASTER_SLAVE) return;
        this.#state = { name: "read-before" };
        send.push(encodeCommand(Command.GET_SYSTEM_VALUE, [0x00, 0x80]));
        return;
      case "read-before": {
        if (command !== Command.GET_SYSTEM_VALUE) return;
        const before = parseStationSystem(data);
        if (!before) { this.#restore({ type: "write-failed", reason: "unexpected" }, send, events); return; }
        const steps: Step[] = [...(this.#plan.time ? ["set-time" as const] : []),
          ...(this.#plan.code !== undefined || this.#plan.mode !== undefined ? ["set-config" as const] : []), "read-after", "read-clock"];
        this.#next({ name: "writing", step: steps[0]!, before, steps }, send);
        return;
      }
      case "writing": {
        const expected = { "set-time": Command.SET_TIME, "set-config": Command.SET_SYSTEM_VALUE, "read-after": Command.GET_SYSTEM_VALUE,
          "read-clock": Command.GET_TIME }[state.step];
        if (command !== expected) return;
        if (state.step === "read-after") {
          const after = parseStationSystem(data);
          if (!after) { this.#restore({ type: "write-failed", reason: "unexpected", before: state.before }, send, events); return; }
          state.after = after;
        }
        if (state.step === "read-clock") { this.#done(state.before, state.after!, decodeStationClock(data) ?? null, send, events); return; }
        const index = state.steps.indexOf(state.step);
        this.#next({ ...state, step: state.steps[index + 1]! }, send);
        return;
      }
      case "restore":
        if (command === Command.SET_MASTER_SLAVE) { this.#state = { name: "idle" }; events.push(state.event); }
        return;
    }
  }

  #next(state: Extract<State, { name: "writing" }>, send: Uint8Array[]): void {
    this.#state = state;
    const plan = this.#plan;
    if (state.step === "set-time") send.push(encodeCommand(Command.SET_TIME, encodeStationClock(plan.time!.clock, plan.time!.dayOfWeek)));
    else if (state.step === "set-config") {
      // Läget (0x71), koden (0x72) och 0x73 med kodens två höga bitar; det som inte ändras skrivs med sitt gamla värde.
      const mode = plan.mode ?? state.before.mode;
      const code = plan.code ?? state.before.code;
      const flags = (state.before.flags73 & 0x3f) | ((code >> 8) & 0x03) << 6;
      send.push(encodeCommand(Command.SET_SYSTEM_VALUE, [SystemOffset.MODE, mode, code & 0xff, flags]));
    } else if (state.step === "read-after") send.push(encodeCommand(Command.GET_SYSTEM_VALUE, [0x00, 0x80]));
    else send.push(encodeCommand(Command.GET_TIME));
  }

  #done(before: StationSystemData, after: StationSystemData, clockAfter: StationClock | null, send: Uint8Array[], events: StationWriteEvent[]): void {
    const report: StationWriteReport = { before, after, clockAfter,
      codeOk: this.#plan.code === undefined || after.code === this.#plan.code, modeOk: this.#plan.mode === undefined || after.mode === this.#plan.mode };
    this.#restore({ type: "station-written", report }, send, events);
  }

  #restore(event: StationWriteEvent, send: Uint8Array[], events: StationWriteEvent[]): void {
    if (!this.#remote) { this.#state = { name: "idle" }; events.push(event); return; }
    this.#state = { name: "restore", event };
    send.push(encodeCommand(Command.SET_MASTER_SLAVE, [MASTER_DIRECT]));
  }
}
