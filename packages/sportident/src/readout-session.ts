import { ACK, Command, MASTER_DIRECT, StationMode, SystemOffset } from "./constants";
import { cardReadPlan, cardTypeFromSi8PlusNumber, decodeCardNumber, type SiCardType } from "./card-types";
import { cardImageFromResponses, CardDecodeError, decodeCard, type SiCardData } from "./decode";
import { encodeCommand, FrameDecoder, type SiFrame } from "./frame";

export interface StationInfo {
  readonly serialNumber: number;
  readonly stationCode: number;
  readonly mode: number;
  readonly extendedProtocol: boolean;
  readonly handshake: boolean;
}

export type ReadoutEvent =
  | { readonly type: "station-ready"; readonly station: StationInfo }
  | {
      readonly type: "station-misconfigured";
      readonly station: StationInfo;
      readonly problems: readonly ("not-extended-protocol" | "not-readout-mode")[];
    }
  | { readonly type: "no-response" }
  | { readonly type: "card-inserted"; readonly cardNumber: number; readonly cardType: SiCardType }
  | { readonly type: "card-unsupported"; readonly cardNumber: number }
  | { readonly type: "card-read"; readonly card: SiCardData; readonly frames: readonly Uint8Array[] }
  | { readonly type: "card-removed" }
  | {
      readonly type: "read-failed";
      readonly cardNumber: number;
      readonly reason: "removed" | "timeout" | "nak" | "decode" | "mismatch";
      readonly frames: readonly Uint8Array[];
    }
  | { readonly type: "frame-error"; readonly reason: string };

export interface SessionOutput {
  /** Bytes som värden ska skriva till stationen, i ordning. */
  readonly send: readonly Uint8Array[];
  readonly events: readonly ReadoutEvent[];
}

interface Reading {
  readonly cardNumber: number;
  readonly cardType: SiCardType;
  readonly steps: ReturnType<typeof cardReadPlan>;
  step: number;
  received: number;
  readonly responses: Uint8Array[];
  readonly frames: Uint8Array[];
}

type State =
  | { readonly name: "idle" }
  | { readonly name: "set-master" }
  | { readonly name: "get-config" }
  | { readonly name: "waiting"; readonly station: StationInfo }
  | { readonly name: "reading"; readonly station: StationInfo; readonly reading: Reading };

/**
 * Tillståndsmaskin för en avläsningsstation (BSM7/BSM8/SI-USB i läget
 * "Readout" med utökat protokoll). Den gör ingen I/O: värden skickar in
 * mottagna bytes och tidsgränser och skriver ut `send`-bytes.
 */
export class ReadoutSession {
  readonly #decoder = new FrameDecoder();
  #state: State = { name: "idle" };

  /** Startar handskakningen: direktläge och läsning av stationens inställningar. */
  start(): SessionOutput {
    this.#decoder.flush();
    this.#state = { name: "set-master" };
    return { send: [encodeCommand(Command.SET_MASTER_SLAVE, [MASTER_DIRECT])], events: [] };
  }

  /** Sant när sessionen väntar på svar och värden bör ha en tidsgräns igång. */
  get expectsResponse(): boolean {
    const name = this.#state.name;
    return name === "set-master" || name === "get-config" || name === "reading";
  }

  get station(): StationInfo | undefined {
    const state = this.#state;
    return state.name === "waiting" || state.name === "reading" ? state.station : undefined;
  }

  receive(chunk: Uint8Array): SessionOutput {
    const send: Uint8Array[] = [];
    const events: ReadoutEvent[] = [];
    for (const event of this.#decoder.push(chunk)) {
      if (event.kind === "frame") this.#onFrame(event.frame, send, events);
      else if (event.kind === "nak") this.#onNak(events);
      else if (event.kind === "error") events.push({ type: "frame-error", reason: event.reason });
    }
    return { send, events };
  }

  /** Värdens tidsgräns löpte ut utan svar. */
  timeout(): SessionOutput {
    const events: ReadoutEvent[] = [];
    for (const event of this.#decoder.flush()) {
      if (event.kind === "error") events.push({ type: "frame-error", reason: event.reason });
    }
    const state = this.#state;
    if (state.name === "set-master" || state.name === "get-config") {
      this.#state = { name: "idle" };
      events.push({ type: "no-response" });
    } else if (state.name === "reading") {
      this.#state = { name: "waiting", station: state.station };
      events.push({ type: "read-failed", cardNumber: state.reading.cardNumber, reason: "timeout", frames: state.reading.frames });
    }
    return { send: [], events };
  }

  #onNak(events: ReadoutEvent[]): void {
    const state = this.#state;
    if (state.name === "reading") {
      this.#state = { name: "waiting", station: state.station };
      events.push({ type: "read-failed", cardNumber: state.reading.cardNumber, reason: "nak", frames: state.reading.frames });
    } else if (state.name === "set-master" || state.name === "get-config") {
      this.#state = { name: "idle" };
      events.push({ type: "no-response" });
    }
  }

  #onFrame(frame: SiFrame, send: Uint8Array[], events: ReadoutEvent[]): void {
    const state = this.#state;
    switch (state.name) {
      case "idle":
        return;
      case "set-master":
        if (frame.command === Command.SET_MASTER_SLAVE) {
          this.#state = { name: "get-config" };
          send.push(encodeCommand(Command.GET_SYSTEM_VALUE, [0x00, 0x80]));
        }
        return;
      case "get-config": {
        if (frame.command !== Command.GET_SYSTEM_VALUE) return;
        const station = parseSystemValues(frame);
        const problems: ("not-extended-protocol" | "not-readout-mode")[] = [];
        if (!station.extendedProtocol) problems.push("not-extended-protocol");
        if (station.mode !== StationMode.READOUT) problems.push("not-readout-mode");
        this.#state = { name: "waiting", station };
        events.push(problems.length === 0 ? { type: "station-ready", station } : { type: "station-misconfigured", station, problems });
        return;
      }
      case "waiting":
        this.#onWaitingFrame(state.station, frame, send, events);
        return;
      case "reading":
        this.#onReadingFrame(state.station, state.reading, frame, send, events);
        return;
    }
  }

  #onWaitingFrame(station: StationInfo, frame: SiFrame, send: Uint8Array[], events: ReadoutEvent[]): void {
    if (frame.command === Command.CARD_REMOVED) {
      events.push({ type: "card-removed" });
      return;
    }
    const detected = detectCard(frame);
    if (!detected) return;
    if (!detected.cardType) {
      events.push({ type: "card-unsupported", cardNumber: detected.cardNumber });
      return;
    }
    const reading: Reading = {
      cardNumber: detected.cardNumber,
      cardType: detected.cardType,
      steps: cardReadPlan(detected.cardType),
      step: 0,
      received: 0,
      responses: [],
      frames: [frame.raw]
    };
    this.#state = { name: "reading", station, reading };
    events.push({ type: "card-inserted", cardNumber: detected.cardNumber, cardType: detected.cardType });
    this.#requestStep(station, reading, send);
  }

  #requestStep(station: StationInfo, reading: Reading, send: Uint8Array[]): void {
    // Utan handskakning skickar stationen data själv; då begär vi inget.
    if (!station.handshake) return;
    const step = reading.steps[reading.step]!;
    send.push(encodeCommand(step.command, step.params));
  }

  #onReadingFrame(station: StationInfo, reading: Reading, frame: SiFrame, send: Uint8Array[], events: ReadoutEvent[]): void {
    if (frame.command === Command.CARD_REMOVED) {
      reading.frames.push(frame.raw);
      this.#state = { name: "waiting", station };
      events.push({ type: "read-failed", cardNumber: reading.cardNumber, reason: "removed", frames: reading.frames });
      events.push({ type: "card-removed" });
      return;
    }
    const step = reading.steps[reading.step]!;
    if (frame.command !== step.command) return;
    reading.frames.push(frame.raw);
    reading.responses.push(frame.data);
    reading.received += 1;
    if (reading.received < step.responses) return;
    reading.step += 1;
    reading.received = 0;
    if (reading.step < reading.steps.length) {
      this.#requestStep(station, reading, send);
      return;
    }
    this.#state = { name: "waiting", station };
    try {
      const image = cardImageFromResponses(reading.cardType, reading.responses);
      const card = decodeCard(reading.cardType, image);
      if (card.cardNumber !== reading.cardNumber) {
        events.push({ type: "read-failed", cardNumber: reading.cardNumber, reason: "mismatch", frames: reading.frames });
        return;
      }
      events.push({ type: "card-read", card, frames: reading.frames });
      // Kvittens får stationen att pipa och blinka.
      send.push(Uint8Array.of(ACK));
    } catch (error) {
      if (!(error instanceof CardDecodeError)) throw error;
      events.push({ type: "read-failed", cardNumber: reading.cardNumber, reason: "decode", frames: reading.frames });
    }
  }
}

/** Tolkar svaret på GET_SYSTEM_VALUE 0x00 0x80. Första databyten är offset-ekot. */
export function parseSystemValues(frame: SiFrame): StationInfo {
  const at = (offset: number): number => frame.data[offset + 1] ?? 0;
  const protocol = at(SystemOffset.PROTOCOL);
  const serialNumber =
    ((at(SystemOffset.SERIAL_NUMBER) << 24) >>> 0) +
    (at(SystemOffset.SERIAL_NUMBER + 1) << 16) +
    (at(SystemOffset.SERIAL_NUMBER + 2) << 8) +
    at(SystemOffset.SERIAL_NUMBER + 3);
  return {
    serialNumber,
    stationCode: frame.stationCode,
    mode: at(SystemOffset.MODE),
    extendedProtocol: (protocol & 0b001) !== 0,
    handshake: (protocol & 0b100) !== 0
  };
}

function detectCard(frame: SiFrame): { cardNumber: number; cardType: SiCardType | undefined } | undefined {
  const d = frame.data;
  if (d.length < 4) return undefined;
  const cardNumber = decodeCardNumber(d[1]!, d[2]!, d[3]!);
  switch (frame.command) {
    case Command.SI5_DETECTED:
      return { cardNumber, cardType: "SI5" };
    case Command.SI6_DETECTED:
      return { cardNumber, cardType: "SI6" };
    case Command.SI8_PLUS_DETECTED:
      return { cardNumber, cardType: cardTypeFromSi8PlusNumber(cardNumber) };
    default:
      return undefined;
  }
}
