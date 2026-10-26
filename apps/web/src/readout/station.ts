import type { ByteTransport, Unsubscribe } from "@o-tid/device-transport";
import { ReadoutSession, stationClockToDate, type ReadoutEvent, type SessionOutput, type SiCardData, type StationInfo } from "@o-tid/sportident";

/**
 * Stationens klocka i förhållande till datorns (PLAN.md steg 22): stationens tid minus datorns
 * vid handskakningen. Saknas när stationen inte svarade på GET_TIME.
 */
export interface StationClockInfo {
  readonly clockOffsetMs: number;
}

export type StationStatus =
  | { readonly kind: "disconnected" }
  | { readonly kind: "connecting" }
  | { readonly kind: "ready"; readonly serialNumber: number; readonly clock?: StationClockInfo }
  | { readonly kind: "misconfigured"; readonly problems: readonly string[] }
  | { readonly kind: "no-response" }
  | { readonly kind: "error"; readonly message: string };

/** Det en avläsning bär om stationen: serienummer och klocka (om stationen har svarat med en). */
export interface StationFacts {
  readonly serialNumber: number | undefined;
  readonly clock: StationClockInfo | undefined;
}

export interface StationCallbacks {
  onStatus(status: StationStatus): void;
  onCardInserted(cardNumber: number): void;
  onCardRead(card: SiCardData, frames: readonly Uint8Array[], station: StationFacts): void;
  onReadFailed(cardNumber: number, reason: string): void;
  onUnsupportedCard(cardNumber: number): void;
  /** Varje mottagen och skickad byteföljd, för rålogg vid felsökning med riktig station. */
  onTraffic?(direction: "in" | "out", bytes: Uint8Array): void;
  /** Steg 53: händelser i klartext till felsökningsloggen (utläsningssätt, tid, reservväg). Inga namn. */
  onLog?(text: string): void;
}

const FAST_READ_KEY = "otid.readout.fast-read.v1";

/** Steg 53: "Snabb utläsning av SI10/11/SIAC" (på som förval), sparad i webbläsaren. */
export function loadFastRead(storage?: Pick<Storage, "getItem">): boolean {
  try { return (storage ?? window.localStorage).getItem(FAST_READ_KEY) !== "off"; }
  catch (error) { console.warn("Valet för snabb utläsning kunde inte läsas; den är på", error); return true; }
}

export function saveFastRead(enabled: boolean, storage?: Pick<Storage, "setItem">): void {
  try { (storage ?? window.localStorage).setItem(FAST_READ_KEY, enabled ? "on" : "off"); }
  catch (error) { console.warn("Valet för snabb utläsning kunde inte sparas i webbläsaren", error); }
}

const FALLBACK_REASONS: Record<string, string> = {
  nak: "stationen svarade NAK", "wrong-block": "svar med fel block", timeout: "inget svar",
  mismatch: "block 0 från en annan bricka", inconsistent: "blocken stämmer inte med block 0"
};

/**
 * Kör protokollets tillståndsmaskin mot en bytetransport: skriver kommandon,
 * matar in mottagna bytes och håller tidsgränsen för väntade svar.
 */
export class StationController {
  readonly #transport: ByteTransport;
  readonly #callbacks: StationCallbacks;
  readonly #timeoutMs: number;
  readonly #timeZone: string;
  readonly #session: ReadoutSession;
  /** När brickan sattes i (för utläsningstiden i felsökningsloggen). */
  #insertedAt: number | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #unsubscribe: Unsubscribe[] = [];
  #facts: StationFacts = { serialNumber: undefined, clock: undefined };
  #handshakeDone: ((ok: boolean) => void) | undefined;

  /** `timeZone`: tävlingens tidszon, som stationens väggklocka tolkas i. */
  constructor(transport: ByteTransport, callbacks: StationCallbacks,
    options: { timeoutMs?: number; timeZone?: string; fastRead?: boolean } = {}) {
    this.#session = new ReadoutSession({ fastRead: options.fastRead ?? true });
    this.#transport = transport;
    this.#callbacks = callbacks;
    this.#timeoutMs = options.timeoutMs ?? 3000;
    this.#timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  /** Steg 53: snabb utläsning av SI6 och SI10/11/SIAC; gäller från nästa bricka. */
  set fastRead(value: boolean) { this.#session.fastRead = value; }
  get fastRead(): boolean { return this.#session.fastRead; }

  /** Stationens klocka i förhållande till datorns, när stationen har svarat på GET_TIME. */
  get clock(): StationClockInfo | undefined { return this.#facts.clock; }

  #remember(station: StationInfo): void {
    const clock = station.clock
      ? { clockOffsetMs: stationClockToDate(station.clock, this.#timeZone).getTime() - Date.now() } : undefined;
    this.#facts = { serialNumber: station.serialNumber, clock };
  }

  /** Öppnar transporten och handskakar. Sant om stationen svarade. */
  async start(): Promise<boolean> {
    this.#callbacks.onStatus({ kind: "connecting" });
    this.#unsubscribe.push(this.#transport.onBytes((chunk) => {
      this.#callbacks.onTraffic?.("in", chunk);
      this.#handle(this.#session.receive(chunk));
    }));
    this.#unsubscribe.push(this.#transport.onState((state) => {
      if (state.status === "detached") this.#callbacks.onStatus({ kind: "error", message: state.message });
      if (state.status === "error") this.#callbacks.onStatus({ kind: "error", message: state.message });
    }));
    await this.#transport.open();
    const answered = new Promise<boolean>((resolve) => { this.#handshakeDone = resolve; });
    this.#handle(this.#session.start());
    return answered;
  }

  async stop(): Promise<void> {
    clearTimeout(this.#timer);
    for (const unsubscribe of this.#unsubscribe) unsubscribe();
    this.#unsubscribe = [];
    await this.#transport.close();
    this.#callbacks.onStatus({ kind: "disconnected" });
  }

  get transport(): ByteTransport { return this.#transport; }

  #handle(output: SessionOutput): void {
    for (const event of output.events) this.#event(event);
    for (const bytes of output.send) {
      this.#callbacks.onTraffic?.("out", bytes);
      void this.#transport.write(bytes).catch((error: unknown) => {
        this.#callbacks.onStatus({ kind: "error", message: error instanceof Error ? error.message : "Skrivfel mot stationen" });
      });
    }
    clearTimeout(this.#timer);
    if (this.#session.expectsResponse) {
      this.#timer = setTimeout(() => this.#handle(this.#session.timeout()), this.#timeoutMs);
    }
  }

  #logStation(station: StationInfo): void {
    const hex = (value: number) => `0x${value.toString(16).padStart(2, "0")}`;
    this.#callbacks.onLog?.(`Station ${station.serialNumber}: kod ${station.stationCode}, läge ${hex(station.mode)}, `
      + `utökat protokoll ${station.extendedProtocol ? "på" : "av"}, handskakning ${station.handshake ? "på" : "av"}, `
      + `blockinställning ${hex(station.cardBlocks)}, snabb utläsning ${this.#session.fastRead ? "på" : "av"}`);
  }

  #event(event: ReadoutEvent): void {
    switch (event.type) {
      case "station-ready":
        this.#remember(event.station);
        this.#logStation(event.station);
        this.#callbacks.onStatus({ kind: "ready", serialNumber: event.station.serialNumber,
          ...(this.#facts.clock ? { clock: this.#facts.clock } : {}) });
        this.#handshakeDone?.(true);
        return;
      case "station-misconfigured":
        this.#remember(event.station);
        this.#logStation(event.station);
        this.#callbacks.onStatus({ kind: "misconfigured", problems: event.problems });
        this.#handshakeDone?.(true);
        return;
      case "no-response":
        this.#callbacks.onStatus({ kind: "no-response" });
        this.#handshakeDone?.(false);
        return;
      case "card-inserted":
        this.#insertedAt = Date.now();
        this.#callbacks.onCardInserted(event.cardNumber);
        return;
      case "card-read": {
        const ms = this.#insertedAt === undefined ? undefined : Date.now() - this.#insertedAt;
        this.#callbacks.onLog?.(`${event.card.cardType} ${event.card.cardNumber}: ${event.readMode === "fast" ? "snabb utläsning" : "hel utläsning"}, `
          + `${event.frames.length - 1} svar${ms === undefined ? "" : `, ${ms} ms`}`);
        this.#callbacks.onCardRead(event.card, event.frames, this.#facts);
        return;
      }
      case "fast-read-fallback":
        this.#callbacks.onLog?.(`${event.cardType} ${event.cardNumber}: snabb utläsning gav upp (${FALLBACK_REASONS[event.reason] ?? event.reason}) `
          + `efter ${event.frames.length - 1} svar; läser om med alla block`);
        return;
      case "read-failed":
        this.#callbacks.onLog?.(`${event.cardNumber}: avläsningen misslyckades (${event.reason})`);
        this.#callbacks.onReadFailed(event.cardNumber, event.reason);
        return;
      case "card-unsupported":
        this.#callbacks.onUnsupportedCard(event.cardNumber);
        return;
      case "card-removed":
      case "frame-error":
        return;
    }
  }
}
