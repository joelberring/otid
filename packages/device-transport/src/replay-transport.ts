import {
  CaptureValidationError,
  validateCaptureBundleV1,
  type CaptureTimelineBytesEntryV1,
  type LoadedCaptureV1,
  type ValidatedCaptureV1
} from "./capture";
import {
  TransportOperationError,
  type ByteTransport,
  type TransportCloseReason,
  type TransportState,
  type Unsubscribe
} from "./byte-transport";
import { errorMessage, TransportListeners } from "./listeners";

export interface ReplayScheduleHandle {
  cancel(): void;
}

/** Delay is relative to the capture's first recorded event, in microseconds. */
export interface ReplayScheduler {
  schedule(delayMicroseconds: number, task: () => void): ReplayScheduleHandle;
}

export type ReplayTiming =
  | { readonly mode: "immediate" }
  | { readonly mode: "recorded"; readonly scheduler: ReplayScheduler };

export interface ReplayTransportOptions {
  readonly timing?: ReplayTiming;
  /** Strict matching is the default and consumes recorded tx chunks in order. */
  readonly writeMode?: "match-recorded" | "ignore";
}

type Lifecycle = "closed" | "opening" | "open" | "closing";

export class ReplayTransport implements ByteTransport {
  readonly kind = "replay" as const;
  readonly #source: LoadedCaptureV1;
  readonly #timing: ReplayTiming;
  readonly #writeMode: "match-recorded" | "ignore";
  readonly #listeners = new TransportListeners({ status: "closed", reason: "initial" });
  #lifecycle: Lifecycle = "closed";
  #validated: ValidatedCaptureV1 | undefined;
  #scheduled: ReplayScheduleHandle[] = [];
  #generation = 0;
  #nextWriteIndex = 0;

  constructor(source: LoadedCaptureV1, options: ReplayTransportOptions = {}) {
    this.#source = source;
    this.#timing = options.timing ?? { mode: "immediate" };
    this.#writeMode = options.writeMode ?? "match-recorded";
  }

  onBytes(handler: (chunk: Uint8Array) => void): Unsubscribe {
    return this.#listeners.onBytes(handler);
  }

  onState(handler: (state: TransportState) => void): Unsubscribe {
    return this.#listeners.onState(handler);
  }

  async open(): Promise<void> {
    if (this.#lifecycle === "open") return;
    if (this.#lifecycle !== "closed") {
      throw new TransportOperationError("REPLAY_ALREADY_OPEN", "Replaytransporten är redan öppen eller öppnas");
    }
    this.#lifecycle = "opening";
    this.#listeners.emitState({ status: "opening" });

    let validated: ValidatedCaptureV1;
    try {
      validated = validateCaptureBundleV1(this.#source);
    } catch (error) {
      this.#lifecycle = "closed";
      const code = error instanceof CaptureValidationError ? error.code : "CAPTURE_VALIDATION_FAILED";
      this.#listeners.emitState({ status: "error", code, message: errorMessage(error) });
      this.#listeners.emitState({ status: "closed", reason: "error" });
      throw error;
    }

    this.#validated = validated;
    this.#nextWriteIndex = 0;
    this.#generation += 1;
    const generation = this.#generation;
    this.#lifecycle = "open";
    this.#listeners.emitState({ status: "open" });

    if (this.#timing.mode === "immediate") {
      for (const entry of validated.timeline) {
        if (this.#lifecycle !== "open" || generation !== this.#generation) break;
        if (entry.type === "bytes" && entry.direction === "rx") {
          this.#emitEntry(validated, entry.offset, entry.length);
        }
      }
      return;
    }

    const baseline = validated.timeline[0]?.monotonicTimeUs ?? 0;
    try {
      for (const entry of validated.timeline) {
        if (entry.type !== "bytes" || entry.direction !== "rx") continue;
        const handle = this.#timing.scheduler.schedule(entry.monotonicTimeUs - baseline, () => {
          if (this.#lifecycle !== "open" || generation !== this.#generation) return;
          this.#emitEntry(validated, entry.offset, entry.length);
        });
        if (this.#lifecycle === "open" && generation === this.#generation) this.#scheduled.push(handle);
        else handle.cancel();
      }
    } catch (error) {
      const operationError = new TransportOperationError("REPLAY_SCHEDULING_FAILED", errorMessage(error), { cause: error });
      this.#listeners.emitState({ status: "error", code: operationError.code, message: operationError.message });
      this.#finishClose("error");
      throw operationError;
    }
  }

  async close(): Promise<void> {
    if (this.#lifecycle === "closed" || this.#lifecycle === "closing") return;
    this.#finishClose("requested");
  }

  async write(bytes: Uint8Array): Promise<void> {
    const copy = bytes.slice();
    if (this.#lifecycle !== "open" || this.#validated === undefined) {
      throw new TransportOperationError("REPLAY_NOT_OPEN", "Replaytransporten är inte öppen");
    }
    if (this.#writeMode === "ignore") return;
    const writes = this.#validated.timeline.filter(
      (entry): entry is CaptureTimelineBytesEntryV1 => entry.type === "bytes" && entry.direction === "tx"
    );
    const expected = writes[this.#nextWriteIndex];
    if (expected === undefined) {
      const error = new TransportOperationError("UNEXPECTED_REPLAY_WRITE", "Capturefilen innehåller ingen ytterligare tx-chunk");
      this.#listeners.emitState({ status: "error", code: error.code, message: error.message });
      this.#listeners.emitState({ status: "open" });
      throw error;
    }
    const expectedBytes = this.#validated.traffic.slice(expected.offset, expected.offset + expected.length);
    if (copy.byteLength !== expectedBytes.byteLength || copy.some((byte, index) => byte !== expectedBytes[index])) {
      const error = new TransportOperationError("REPLAY_WRITE_MISMATCH", "Skrivningen avviker från nästa inspelade tx-chunk");
      this.#listeners.emitState({ status: "error", code: error.code, message: error.message });
      this.#listeners.emitState({ status: "open" });
      throw error;
    }
    this.#nextWriteIndex += 1;
  }

  #emitEntry(capture: ValidatedCaptureV1, offset: number, length: number): void {
    this.#listeners.emitBytes(capture.traffic.slice(offset, offset + length));
  }

  #finishClose(reason: TransportCloseReason): void {
    this.#lifecycle = "closing";
    this.#listeners.emitState({ status: "closing", reason });
    this.#generation += 1;
    for (const handle of this.#scheduled.splice(0)) handle.cancel();
    this.#validated = undefined;
    this.#lifecycle = "closed";
    this.#listeners.emitState({ status: "closed", reason });
  }
}
