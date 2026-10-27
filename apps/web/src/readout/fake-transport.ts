import type { ByteTransport, TransportState, Unsubscribe } from "@o-tid/device-transport";
import { FakeSiStation, stationClockFromDate, type SimulatedCard } from "@o-tid/sportident";

/** Hur länge den falska brickan sitter i efter isättningen och efter stationens senaste svar, om ingen ny bricka sätts i före. */
const REMOVE_AFTER_MS = 400;

/**
 * Övningsstation: en ByteTransport som pratar med en falsk SPORTident-station.
 * Allt går genom samma protokolltolk som en riktig station.
 *
 * Stationens klocka (GET_TIME) följer datorns tills en bricka sätts i med en
 * klocktid; då ställs den dit (strax efter brickans sista stämpling), så att en
 * övning på en annan dag än idag (kommande tävling, fast starttid) läses som om
 * det vore tävlingsdag.
 */
export class FakeStationTransport implements ByteTransport {
  readonly kind = "simulated" as const;
  readonly #station: FakeSiStation;
  readonly #timeZone: string;
  readonly #bytes = new Set<(chunk: Uint8Array) => void>();
  readonly #states = new Set<(state: TransportState) => void>();
  #state: TransportState = { status: "closed", reason: "initial" };
  /** Stationens klocka minus datorns. */
  #clockOffsetMs = 0;
  #current: SimulatedCard | undefined;
  #removeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: { timeZone?: string } = {}) {
    this.#timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.#station = new FakeSiStation({ stationCode: 10, serialNumber: 999_001, clock: () => stationClockFromDate(this.now(), this.#timeZone) });
  }

  /** Stationens klocka just nu. */
  now(): Date { return new Date(Date.now() + this.#clockOffsetMs); }

  async open(): Promise<void> { this.#setState({ status: "open" }); }
  async close(): Promise<void> { this.#setState({ status: "closed", reason: "requested" }); }

  async write(bytes: Uint8Array): Promise<void> {
    const replies = this.#station.receive(bytes);
    // Svara asynkront i små bitar, som en riktig serieport.
    setTimeout(() => {
      for (const reply of replies) this.#emitChunked(reply);
      // Löparen drar brickan en stund efter att stationen har svarat sist, inte en fast tid efter isättningen: annars
      // tas brickan ur mitt i utläsningen när webbläsaren hackar (en belastad dator), och avläsningen "läses inte färdigt".
      const card = this.#current;
      if (card && this.#removeTimer !== undefined && replies.length > 0) {
        clearTimeout(this.#removeTimer);
        this.#removeTimer = setTimeout(() => this.#remove(card), REMOVE_AFTER_MS);
      }
    }, 5);
  }

  onBytes(handler: (chunk: Uint8Array) => void): Unsubscribe {
    this.#bytes.add(handler);
    return () => { this.#bytes.delete(handler); };
  }

  onState(handler: (state: TransportState) => void): Unsubscribe {
    this.#states.add(handler);
    handler(this.#state);
    return () => { this.#states.delete(handler); };
  }

  /**
   * Sätter i en bricka i den falska stationen. Sitter en bricka redan i tas den ur först,
   * som när en löpare drar sin bricka och nästa sätter i sin. `clockAt` ställer stationens
   * klocka (normalt strax efter brickans sista stämpling, på tävlingsdagen).
   */
  insert(card: SimulatedCard, clockAt?: Date): void {
    if (this.#current) this.#remove(this.#current);
    if (clockAt) this.#clockOffsetMs = clockAt.getTime() - Date.now();
    this.#current = card;
    const frames = this.#station.insert(card);
    setTimeout(() => {
      if (this.#current !== card) return;
      for (const frame of frames) this.#emitChunked(frame);
      this.#removeTimer = setTimeout(() => this.#remove(card), REMOVE_AFTER_MS);
    }, 5);
  }

  /** Tar ur brickan om det är den som sitter i; en annan bricka rörs inte. */
  #remove(card: SimulatedCard): void {
    if (this.#current !== card) return;
    clearTimeout(this.#removeTimer);
    this.#removeTimer = undefined;
    this.#current = undefined;
    this.#emitChunked(this.#station.remove());
  }

  #emitChunked(frame: Uint8Array): void {
    for (let offset = 0; offset < frame.length; offset += 32) {
      const chunk = frame.slice(offset, offset + 32);
      for (const handler of this.#bytes) handler(chunk);
    }
  }

  #setState(state: TransportState): void {
    this.#state = state;
    for (const handler of this.#states) handler(state);
  }
}
