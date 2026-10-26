import { ACK, BLOCK_SIZE, Command, MASTER_DIRECT, READ_ALL_BLOCKS, StationMode, SystemOffset } from "./constants";
import {
  CARD_LAYOUTS, cardReadPlan, cardTypeFromSi8PlusNumber, decodeCardNumber, fastReadBlocks, fastReadCommand, LAST_BLOCK,
  type CardReadStep, type SiCardType
} from "./card-types";
import { cardImageFromResponses, CardDecodeError, decodeCard, type SiCardData } from "./decode";
import { encodeCommand, FrameDecoder, type SiFrame } from "./frame";
import { decodeStationClock, type StationClock } from "./time";

export interface StationInfo {
  readonly serialNumber: number;
  readonly stationCode: number;
  readonly mode: number;
  readonly extendedProtocol: boolean;
  readonly handshake: boolean;
  /** Steg 53: stationens blockinställning för "alla block" (`SystemOffset.CARD_BLOCKS`), för felsökningsloggen. */
  readonly cardBlocks: number;
  /**
   * Stationens klocka vid handskakningen (GET_TIME). Saknas när stationen
   * inte svarade på frågan; då får värden använda datorns klocka.
   */
  readonly clock?: StationClock;
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
  | {
      readonly type: "card-read";
      readonly card: SiCardData;
      readonly frames: readonly Uint8Array[];
      /** Steg 53: "fast" = block 0 och bara blocken med stämplingar; "full" = som förut ("alla block", SI5, SI8/SI9). */
      readonly readMode: ReadMode;
    }
  | {
      /**
       * Steg 53: den snabba utläsningen fick ett oväntat svar. Brickan läses om med "alla block" direkt, utan att
       * användaren behöver göra något; `frames` är det som kom i det avbrutna försöket (för felsökningsloggen).
       */
      readonly type: "fast-read-fallback";
      readonly cardNumber: number;
      readonly cardType: SiCardType;
      readonly reason: FastReadFallbackReason;
      readonly frames: readonly Uint8Array[];
    }
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

export type ReadMode = "fast" | "full";

/** Varför den snabba utläsningen gav upp: NAK, svar med fel block, inget svar, fel bricka i block 0, data som inte går ihop. */
export type FastReadFallbackReason = "nak" | "wrong-block" | "timeout" | "mismatch" | "inconsistent";

export interface ReadoutSessionOptions {
  /** Steg 53: snabb utläsning av SI6 och SI10/11/SIAC (förval på). Av = "alla block" som före steg 53. */
  readonly fastRead?: boolean;
}

interface Reading {
  readonly cardNumber: number;
  readonly cardType: SiCardType;
  readonly detection: Uint8Array;
  mode: ReadMode;
  /** Snabb utläsning: blocken som återstår att läsa; det första är det som väntas nu. */
  fastBlocks: number[];
  readonly steps: readonly CardReadStep[];
  step: number;
  received: number;
  responses: Uint8Array[];
  frames: Uint8Array[];
}

type State =
  | { readonly name: "idle" }
  | { readonly name: "set-master" }
  | { readonly name: "get-config" }
  | { readonly name: "get-time"; readonly station: StationInfo }
  | { readonly name: "waiting"; readonly station: StationInfo }
  | { readonly name: "reading"; readonly station: StationInfo; readonly reading: Reading };

/**
 * Tillståndsmaskin för en avläsningsstation (BSM7/BSM8/SI-USB i läget
 * "Readout" med utökat protokoll). Den gör ingen I/O: värden skickar in
 * mottagna bytes och tidsgränser och skriver ut `send`-bytes.
 *
 * Handskakning: SET_MASTER_SLAVE → GET_SYSTEM_VALUE → GET_TIME. En bricka som
 * redan sitter i stationen (eller sätts i under handskakningen) ger en
 * detekteringsram innan sessionen väntar på brickor; den sparas och läses så
 * snart handskakningen är klar.
 */
export class ReadoutSession {
  readonly #decoder = new FrameDecoder();
  #state: State = { name: "idle" };
  /** Senaste detekteringsram som kom under handskakningen. */
  #earlyCard: SiFrame | undefined;
  #fastRead: boolean;

  constructor(options: ReadoutSessionOptions = {}) {
    this.#fastRead = options.fastRead ?? true;
  }

  /** Steg 53: slå på eller av snabb utläsning; gäller från nästa bricka. */
  set fastRead(value: boolean) { this.#fastRead = value; }
  get fastRead(): boolean { return this.#fastRead; }

  /** Startar handskakningen: direktläge och läsning av stationens inställningar. */
  start(): SessionOutput {
    this.#decoder.flush();
    this.#state = { name: "set-master" };
    this.#earlyCard = undefined;
    return { send: [encodeCommand(Command.SET_MASTER_SLAVE, [MASTER_DIRECT])], events: [] };
  }

  /** Sant när sessionen väntar på svar och värden bör ha en tidsgräns igång. */
  get expectsResponse(): boolean {
    const name = this.#state.name;
    return name === "set-master" || name === "get-config" || name === "get-time" || name === "reading";
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
      else if (event.kind === "nak") this.#onNak(send, events);
      else if (event.kind === "error") events.push({ type: "frame-error", reason: event.reason });
    }
    return { send, events };
  }

  /** Värdens tidsgräns löpte ut utan svar. */
  timeout(): SessionOutput {
    const send: Uint8Array[] = [];
    const events: ReadoutEvent[] = [];
    for (const event of this.#decoder.flush()) {
      if (event.kind === "error") events.push({ type: "frame-error", reason: event.reason });
    }
    const state = this.#state;
    if (state.name === "set-master" || state.name === "get-config") {
      this.#state = { name: "idle" };
      events.push({ type: "no-response" });
    } else if (state.name === "get-time") {
      // Stationen svarade inte på GET_TIME: fortsätt utan stationsklocka.
      this.#ready(state.station, send, events);
    } else if (state.name === "reading" && state.reading.mode === "fast") {
      this.#fallBack(state.station, state.reading, "timeout", send, events);
    } else if (state.name === "reading") {
      this.#state = { name: "waiting", station: state.station };
      events.push({ type: "read-failed", cardNumber: state.reading.cardNumber, reason: "timeout", frames: state.reading.frames });
    }
    return { send, events };
  }

  #onNak(send: Uint8Array[], events: ReadoutEvent[]): void {
    const state = this.#state;
    if (state.name === "reading" && state.reading.mode === "fast") {
      this.#fallBack(state.station, state.reading, "nak", send, events);
    } else if (state.name === "reading") {
      this.#state = { name: "waiting", station: state.station };
      events.push({ type: "read-failed", cardNumber: state.reading.cardNumber, reason: "nak", frames: state.reading.frames });
    } else if (state.name === "set-master" || state.name === "get-config") {
      this.#state = { name: "idle" };
      events.push({ type: "no-response" });
    } else if (state.name === "get-time") {
      // Stationen kan inte svara på GET_TIME: fortsätt utan stationsklocka.
      this.#ready(state.station, send, events);
    }
  }

  /** Handskakningen är klar: rapportera stationen och läs en bricka som satt i under tiden. */
  #ready(station: StationInfo, send: Uint8Array[], events: ReadoutEvent[]): void {
    const problems: ("not-extended-protocol" | "not-readout-mode")[] = [];
    if (!station.extendedProtocol) problems.push("not-extended-protocol");
    if (station.mode !== StationMode.READOUT) problems.push("not-readout-mode");
    this.#state = { name: "waiting", station };
    events.push(problems.length === 0 ? { type: "station-ready", station } : { type: "station-misconfigured", station, problems });
    const early = this.#earlyCard;
    this.#earlyCard = undefined;
    if (early) this.#onWaitingFrame(station, early, send, events);
  }

  /** Under handskakningen: kom ihåg en bricka som sätts i (eller redan sitter i) tills stationen är redo. */
  #rememberEarlyCard(frame: SiFrame): void {
    if (frame.command === Command.CARD_REMOVED) this.#earlyCard = undefined;
    else if (detectCard(frame)) this.#earlyCard = frame;
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
        } else this.#rememberEarlyCard(frame);
        return;
      case "get-config": {
        if (frame.command !== Command.GET_SYSTEM_VALUE) { this.#rememberEarlyCard(frame); return; }
        this.#state = { name: "get-time", station: parseSystemValues(frame) };
        send.push(encodeCommand(Command.GET_TIME));
        return;
      }
      case "get-time": {
        if (frame.command !== Command.GET_TIME) { this.#rememberEarlyCard(frame); return; }
        const clock = decodeStationClock(frame.data);
        this.#ready(clock ? { ...state.station, clock } : state.station, send, events);
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
    // Snabb utläsning kräver handskakning: utan den skickar stationen själv det den är inställd på.
    const fast = this.#fastRead && station.handshake && fastReadCommand(detected.cardType) !== undefined;
    const reading: Reading = {
      cardNumber: detected.cardNumber,
      cardType: detected.cardType,
      detection: frame.raw,
      mode: fast ? "fast" : "full",
      fastBlocks: fast ? [0] : [],
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
    if (reading.mode === "fast") {
      send.push(encodeCommand(fastReadCommand(reading.cardType)!, [reading.fastBlocks[0]!]));
      return;
    }
    const step = reading.steps[reading.step]!;
    send.push(encodeCommand(step.command, step.params));
  }

  /**
   * Steg 53: snabb utläsning gav upp. Läs samma bricka med "alla block" som före steg 53. Det avbrutna försökets
   * ramar följer med händelsen men inte avläsningen, så att avläsningens råramar ger samma bild vid omläsning.
   */
  #fallBack(station: StationInfo, reading: Reading, reason: FastReadFallbackReason, send: Uint8Array[], events: ReadoutEvent[]): void {
    events.push({ type: "fast-read-fallback", cardNumber: reading.cardNumber, cardType: reading.cardType, reason, frames: reading.frames });
    reading.mode = "full";
    reading.fastBlocks = [];
    reading.step = 0;
    reading.received = 0;
    reading.responses = [];
    reading.frames = [reading.detection];
    this.#state = { name: "reading", station, reading };
    this.#requestStep(station, reading, send);
  }

  /** Snabb utläsning: ett block i taget, i ordning. Allt oväntat ger "alla block" i stället. */
  #onFastFrame(station: StationInfo, reading: Reading, frame: SiFrame, send: Uint8Array[], events: ReadoutEvent[]): void {
    if (frame.command !== fastReadCommand(reading.cardType)) return;
    const expected = reading.fastBlocks[0]!;
    if (frame.data[0] !== expected || frame.data.length < BLOCK_SIZE + 1) {
      reading.frames.push(frame.raw);
      this.#fallBack(station, reading, "wrong-block", send, events);
      return;
    }
    reading.frames.push(frame.raw);
    reading.responses.push(frame.data);
    reading.fastBlocks.shift();
    if (expected === 0) {
      const block0 = frame.data.subarray(1, BLOCK_SIZE + 1);
      const [high, mid, low] = CARD_LAYOUTS[reading.cardType].cardNumber;
      if (decodeCardNumber(block0[high]!, block0[mid]!, block0[low]!) !== reading.cardNumber) {
        this.#fallBack(station, reading, "mismatch", send, events);
        return;
      }
      reading.fastBlocks = [...fastReadBlocks(reading.cardType, block0)!];
    }
    if (reading.fastBlocks.length > 0) {
      this.#requestStep(station, reading, send);
      return;
    }
    let card: SiCardData;
    let image: Uint8Array;
    try {
      image = cardImageFromResponses(reading.cardType, reading.responses);
      card = decodeCard(reading.cardType, image);
    } catch (error) {
      if (!(error instanceof CardDecodeError)) throw error;
      this.#fallBack(station, reading, "inconsistent", send, events);
      return;
    }
    if (card.cardNumber !== reading.cardNumber || hasEmptyPunch(reading.cardType, image)) {
      this.#fallBack(station, reading, "inconsistent", send, events);
      return;
    }
    this.#finish(station, reading, card, send, events);
  }

  #finish(station: StationInfo, reading: Reading, card: SiCardData, send: Uint8Array[], events: ReadoutEvent[]): void {
    this.#state = { name: "waiting", station };
    events.push({ type: "card-read", card, frames: reading.frames, readMode: reading.mode });
    // Kvittens får stationen att pipa och blinka.
    send.push(Uint8Array.of(ACK));
  }

  #onReadingFrame(station: StationInfo, reading: Reading, frame: SiFrame, send: Uint8Array[], events: ReadoutEvent[]): void {
    const step = reading.steps[reading.step]!;
    const allBlocks = step.params[0] === READ_ALL_BLOCKS;
    if (frame.command === Command.CARD_REMOVED) {
      reading.frames.push(frame.raw);
      this.#state = { name: "waiting", station };
      // "Alla block": brickan kan tas ur efter att stämplingarna kommit men före sista blocket. Räcker det som kom
      // (block 0 och blocken med brickans stämplingar) är avläsningen ändå fullständig. Samma vid snabb utläsning.
      const complete = reading.mode === "fast" || (allBlocks && reading.step === reading.steps.length - 1);
      const card = complete ? this.#tryDecode(reading) : undefined;
      if (card) events.push({ type: "card-read", card, frames: reading.frames, readMode: reading.mode });
      else events.push({ type: "read-failed", cardNumber: reading.cardNumber, reason: "removed", frames: reading.frames });
      events.push({ type: "card-removed" });
      return;
    }
    if (reading.mode === "fast") {
      this.#onFastFrame(station, reading, frame, send, events);
      return;
    }
    if (frame.command !== step.command) return;
    if (allBlocks) {
      // "Alla block" börjar alltid med block 0. Svar före block 0 är rester av ett avbrutet snabbförsök (steg 53), och
      // ett nytt block 0 börjar om samlingen, så att sena svar inte blandas med stationens nya följd.
      if (frame.data[0] === 0) {
        reading.frames = [reading.detection];
        reading.responses = [];
        reading.received = 0;
      } else if (reading.responses.length === 0) return;
    }
    reading.frames.push(frame.raw);
    reading.responses.push(frame.data);
    reading.received += 1;
    // "Alla block" (SI6, SI10/11/SIAC): stationen skickar antingen bara blocken med data (0, 6, 7 / 0, 4–7) eller alla
    // åtta (0–7), beroende på hur den är inställd. Båda slutar med block 7; åtta svar är taket.
    const done = allBlocks ? frame.data[0] === LAST_BLOCK || reading.received >= 8 : reading.received >= step.responses;
    if (!done) return;
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
      this.#finish(station, reading, card, send, events);
    } catch (error) {
      if (!(error instanceof CardDecodeError)) throw error;
      events.push({ type: "read-failed", cardNumber: reading.cardNumber, reason: "decode", frames: reading.frames });
    }
  }

  /** Avkodar det som kommit hittills; undefined om det inte räcker eller inte stämmer. */
  #tryDecode(reading: Reading): SiCardData | undefined {
    try {
      const card = decodeCard(reading.cardType, cardImageFromResponses(reading.cardType, reading.responses));
      return card.cardNumber === reading.cardNumber ? card : undefined;
    } catch (error) {
      if (error instanceof CardDecodeError) return undefined;
      throw error;
    }
  }
}

/**
 * Steg 53: en stämpling inom brickans antal som är helt tom (0xEE). Med "alla block" avkodas den som förut; vid snabb
 * utläsning betyder den att blocken inte går ihop med block 0, och brickan läses om med "alla block".
 */
function hasEmptyPunch(cardType: SiCardType, image: Uint8Array): boolean {
  const layout = CARD_LAYOUTS[cardType];
  const count = Math.min(image[layout.punchCount]!, layout.maxPunches);
  for (let index = 0; index < count; index += 1) {
    const offset = layout.firstPunch + index * layout.punchSize;
    if (image.subarray(offset, offset + layout.punchSize).every((byte) => byte === 0xee)) return true;
  }
  return false;
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
    handshake: (protocol & 0b100) !== 0,
    cardBlocks: at(SystemOffset.CARD_BLOCKS)
  };
}

/** Bricknummer och bricktyp ur en detekteringsram; undefined för andra ramar. */
export function detectCard(frame: SiFrame): { cardNumber: number; cardType: SiCardType | undefined } | undefined {
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
