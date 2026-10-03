import type { ByteTransport, TransportState, Unsubscribe } from "@o-tid/device-transport";
import { FakeSiStation, type SimulatedCard } from "@o-tid/sportident";

/**
 * Övningsstation: en ByteTransport som pratar med en falsk SPORTident-station.
 * Allt går genom samma protokolltolk som en riktig station.
 */
export class FakeStationTransport implements ByteTransport {
  readonly kind = "simulated" as const;
  readonly #station = new FakeSiStation({ stationCode: 10, serialNumber: 999_001 });
  readonly #bytes = new Set<(chunk: Uint8Array) => void>();
  readonly #states = new Set<(state: TransportState) => void>();
  #state: TransportState = { status: "closed", reason: "initial" };

  async open(): Promise<void> { this.#setState({ status: "open" }); }
  async close(): Promise<void> { this.#setState({ status: "closed", reason: "requested" }); }

  async write(bytes: Uint8Array): Promise<void> {
    const replies = this.#station.receive(bytes);
    // Svara asynkront i små bitar, som en riktig serieport.
    setTimeout(() => { for (const reply of replies) this.#emitChunked(reply); }, 5);
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

  /** Sätter i en bricka i den falska stationen. */
  insert(card: SimulatedCard): void {
    const frames = this.#station.insert(card);
    setTimeout(() => {
      for (const frame of frames) this.#emitChunked(frame);
      setTimeout(() => this.#emitChunked(this.#station.remove()), 400);
    }, 5);
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
