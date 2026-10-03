import type { TransportState, Unsubscribe } from "./byte-transport";

type BytesHandler = (chunk: Uint8Array) => void;
type StateHandler = (state: TransportState) => void;

function reportHandlerFailure(kind: "byte" | "state"): void {
  try {
    // Do not include the thrown value: a consumer may accidentally include raw
    // device data in it. Delivery continues for the remaining listeners.
    console.error(`O-Tid ${kind}-transportlyssnare kastade ett fel; callbacken isolerades`);
  } catch {
    // A replaced/broken console must not be allowed to alter transport state.
  }
}

function deliver<T>(kind: "byte" | "state", handler: (value: T) => void, value: T): void {
  try {
    handler(value);
  } catch {
    reportHandlerFailure(kind);
  }
}

export class TransportListeners {
  readonly #bytesHandlers = new Set<BytesHandler>();
  readonly #stateHandlers = new Set<StateHandler>();
  #currentState: TransportState;

  constructor(initialState: TransportState) {
    this.#currentState = Object.freeze({ ...initialState }) as TransportState;
  }

  onBytes(handler: BytesHandler): Unsubscribe {
    this.#bytesHandlers.add(handler);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#bytesHandlers.delete(handler);
    };
  }

  onState(handler: StateHandler): Unsubscribe {
    this.#stateHandlers.add(handler);
    deliver("state", handler, this.#currentState);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#stateHandlers.delete(handler);
    };
  }

  emitBytes(chunk: Uint8Array): void {
    for (const handler of [...this.#bytesHandlers]) {
      deliver("byte", handler, chunk.slice());
    }
  }

  emitState(state: TransportState): void {
    const event = Object.freeze({ ...state }) as TransportState;
    this.#currentState = event;
    for (const handler of [...this.#stateHandlers]) {
      deliver("state", handler, event);
    }
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
