import type { ByteTransport, Unsubscribe } from "@o-tid/device-transport";
import { ReadoutSession, type ReadoutEvent, type SessionOutput, type SiCardData } from "@o-tid/sportident";

export type StationStatus =
  | { readonly kind: "disconnected" }
  | { readonly kind: "connecting" }
  | { readonly kind: "ready"; readonly serialNumber: number }
  | { readonly kind: "misconfigured"; readonly problems: readonly string[] }
  | { readonly kind: "no-response" }
  | { readonly kind: "error"; readonly message: string };

export interface StationCallbacks {
  onStatus(status: StationStatus): void;
  onCardInserted(cardNumber: number): void;
  onCardRead(card: SiCardData, frames: readonly Uint8Array[], stationSerial: number | undefined): void;
  onReadFailed(cardNumber: number, reason: string): void;
  onUnsupportedCard(cardNumber: number): void;
}

/**
 * Kör protokollets tillståndsmaskin mot en bytetransport: skriver kommandon,
 * matar in mottagna bytes och håller tidsgränsen för väntade svar.
 */
export class StationController {
  readonly #transport: ByteTransport;
  readonly #callbacks: StationCallbacks;
  readonly #timeoutMs: number;
  readonly #session = new ReadoutSession();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #unsubscribe: Unsubscribe[] = [];
  #serial: number | undefined;
  #handshakeDone: ((ok: boolean) => void) | undefined;

  constructor(transport: ByteTransport, callbacks: StationCallbacks, timeoutMs = 3000) {
    this.#transport = transport;
    this.#callbacks = callbacks;
    this.#timeoutMs = timeoutMs;
  }

  /** Öppnar transporten och handskakar. Sant om stationen svarade. */
  async start(): Promise<boolean> {
    this.#callbacks.onStatus({ kind: "connecting" });
    this.#unsubscribe.push(this.#transport.onBytes((chunk) => this.#handle(this.#session.receive(chunk))));
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
      void this.#transport.write(bytes).catch((error: unknown) => {
        this.#callbacks.onStatus({ kind: "error", message: error instanceof Error ? error.message : "Skrivfel mot stationen" });
      });
    }
    clearTimeout(this.#timer);
    if (this.#session.expectsResponse) {
      this.#timer = setTimeout(() => this.#handle(this.#session.timeout()), this.#timeoutMs);
    }
  }

  #event(event: ReadoutEvent): void {
    switch (event.type) {
      case "station-ready":
        this.#serial = event.station.serialNumber;
        this.#callbacks.onStatus({ kind: "ready", serialNumber: event.station.serialNumber });
        this.#handshakeDone?.(true);
        return;
      case "station-misconfigured":
        this.#serial = event.station.serialNumber;
        this.#callbacks.onStatus({ kind: "misconfigured", problems: event.problems });
        this.#handshakeDone?.(true);
        return;
      case "no-response":
        this.#callbacks.onStatus({ kind: "no-response" });
        this.#handshakeDone?.(false);
        return;
      case "card-inserted":
        this.#callbacks.onCardInserted(event.cardNumber);
        return;
      case "card-read":
        this.#callbacks.onCardRead(event.card, event.frames, this.#serial);
        return;
      case "read-failed":
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
