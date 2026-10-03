import {
  TransportOperationError,
  type ByteTransport,
  type TransportCloseReason,
  type TransportState,
  type Unsubscribe
} from "./byte-transport";
import { errorMessage, TransportListeners } from "./listeners";

export interface WebSerialReadResult {
  readonly done: boolean;
  readonly value?: Uint8Array;
}

export interface WebSerialReaderLike {
  read(): Promise<WebSerialReadResult>;
  cancel(reason?: unknown): Promise<void>;
  releaseLock(): void;
}

export interface WebSerialWriterLike {
  write(bytes: Uint8Array): Promise<void>;
  releaseLock(): void;
}

export interface WebSerialReadableLike {
  getReader(): WebSerialReaderLike;
}

export interface WebSerialWritableLike {
  getWriter(): WebSerialWriterLike;
}

export interface WebSerialOpenOptions {
  readonly baudRate: number;
  readonly dataBits?: 7 | 8;
  readonly stopBits?: 1 | 2;
  readonly parity?: "none" | "even" | "odd";
  readonly bufferSize?: number;
  readonly flowControl?: "none" | "hardware";
}

/** Local structural type so this package does not depend on experimental DOM declarations. */
export interface WebSerialPortLike {
  readonly readable: WebSerialReadableLike | null;
  readonly writable: WebSerialWritableLike | null;
  open(options: WebSerialOpenOptions): Promise<void>;
  close(): Promise<void>;
  addEventListener?(type: "disconnect", listener: () => void): void;
  removeEventListener?(type: "disconnect", listener: () => void): void;
}

type Lifecycle = "closed" | "opening" | "open" | "closing" | "error";

export class WebSerialTransport implements ByteTransport {
  readonly kind = "web-serial" as const;
  readonly #port: WebSerialPortLike;
  readonly #openOptions: WebSerialOpenOptions;
  readonly #listeners = new TransportListeners({ status: "closed", reason: "initial" });
  readonly #disconnectListener = (): void => {
    if (this.#lifecycle === "closed" || this.#lifecycle === "closing") return;
    this.#listeners.emitState({ status: "detached", message: "Serieporten kopplades från" });
    void this.#closeFromOutside("detached").catch((error: unknown) => this.#reportUnexpectedCloseFailure(error));
  };
  #lifecycle: Lifecycle = "closed";
  #reader: WebSerialReaderLike | undefined;
  #readTask: Promise<void> | undefined;
  #closeTask: Promise<void> | undefined;
  #writeTail: Promise<void> = Promise.resolve();
  #disconnectAttached = false;
  #portOpened = false;

  constructor(port: WebSerialPortLike, openOptions: WebSerialOpenOptions) {
    if (!Number.isSafeInteger(openOptions.baudRate) || openOptions.baudRate <= 0) {
      throw new TransportOperationError("INVALID_BAUD_RATE", "baudRate måste vara ett positivt heltal");
    }
    this.#port = port;
    this.#openOptions = Object.freeze({ ...openOptions });
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
      throw new TransportOperationError("WEB_SERIAL_ALREADY_OPEN", "Web Serial-transporten är redan öppen eller öppnas");
    }
    this.#lifecycle = "opening";
    this.#listeners.emitState({ status: "opening" });
    this.#attachDisconnect();
    try {
      await this.#port.open(this.#openOptions);
      this.#portOpened = true;
      if (this.#lifecycle !== "opening") {
        throw new TransportOperationError("WEB_SERIAL_OPEN_CANCELLED", "Öppningen avbröts");
      }
      if (this.#port.readable === null) {
        throw new TransportOperationError("WEB_SERIAL_NOT_READABLE", "Serieporten saknar läsbar ström");
      }
      this.#reader = this.#port.readable.getReader();
      this.#lifecycle = "open";
      this.#listeners.emitState({ status: "open" });
      this.#readTask = this.#readLoop(this.#reader);
    } catch (error) {
      const operationError = error instanceof TransportOperationError
        ? error
        : new TransportOperationError("WEB_SERIAL_OPEN_FAILED", errorMessage(error), { cause: error });
      this.#listeners.emitState({ status: "error", code: operationError.code, message: operationError.message });
      this.#detachDisconnect();
      if (this.#portOpened) {
        try {
          await this.#closePort("WEB_SERIAL_OPEN_CLEANUP_FAILED");
        } catch (cleanupError) {
          throw new TransportOperationError(
            "WEB_SERIAL_OPEN_CLEANUP_FAILED",
            errorMessage(cleanupError),
            { cause: operationError }
          );
        }
      }
      this.#lifecycle = "closed";
      this.#listeners.emitState({ status: "closed", reason: "error" });
      throw operationError;
    }
  }

  async close(): Promise<void> {
    return this.#closeFromOutside("requested");
  }

  async write(bytes: Uint8Array): Promise<void> {
    const copy = bytes.slice();
    if (this.#lifecycle !== "open") {
      throw new TransportOperationError("WEB_SERIAL_NOT_OPEN", "Web Serial-transporten är inte öppen");
    }
    if (copy.byteLength === 0) {
      throw new TransportOperationError("EMPTY_WRITE", "Tomma skrivningar tillåts inte");
    }
    const operation = this.#writeTail.then(() => this.#performWrite(copy));
    this.#writeTail = operation.catch(() => undefined);
    return operation;
  }

  async #performWrite(bytes: Uint8Array): Promise<void> {
    if (this.#lifecycle !== "open" || this.#port.writable === null) {
      throw new TransportOperationError("WEB_SERIAL_NOT_WRITABLE", "Serieporten är inte skrivbar");
    }
    let writer: WebSerialWriterLike | undefined;
    try {
      writer = this.#port.writable.getWriter();
      await writer.write(bytes);
    } catch (error) {
      const operationError = error instanceof TransportOperationError
        ? error
        : new TransportOperationError("WEB_SERIAL_WRITE_FAILED", errorMessage(error), { cause: error });
      this.#listeners.emitState({ status: "error", code: operationError.code, message: operationError.message });
      void this.#closeFromOutside("error").catch((closeError: unknown) => this.#reportUnexpectedCloseFailure(closeError));
      throw operationError;
    } finally {
      if (writer !== undefined) {
        try {
          writer.releaseLock();
        } catch (error) {
          this.#listeners.emitState({
            status: "error",
            code: "WEB_SERIAL_WRITER_RELEASE_FAILED",
            message: errorMessage(error)
          });
        }
      }
    }
  }

  async #readLoop(reader: WebSerialReaderLike): Promise<void> {
    let closeReason: TransportCloseReason = "completed";
    try {
      while (this.#lifecycle === "open") {
        const result = await reader.read();
        if (result.done) break;
        if (result.value !== undefined && result.value.byteLength > 0) {
          this.#listeners.emitBytes(result.value);
        }
      }
    } catch (error) {
      if (this.#lifecycle !== "closing") {
        closeReason = "error";
        this.#listeners.emitState({ status: "error", code: "WEB_SERIAL_READ_FAILED", message: errorMessage(error) });
      }
    } finally {
      if (this.#reader === reader) this.#reader = undefined;
      try {
        reader.releaseLock();
      } catch (error) {
        this.#listeners.emitState({
          status: "error",
          code: "WEB_SERIAL_READER_RELEASE_FAILED",
          message: errorMessage(error)
        });
        closeReason = "error";
      }
      if (this.#lifecycle === "open") await this.#closeAfterReadLoop(closeReason);
    }
  }

  #closeFromOutside(reason: TransportCloseReason): Promise<void> {
    if (this.#lifecycle === "closed") return Promise.resolve();
    if (this.#lifecycle === "closing") return this.#closeTask ?? Promise.resolve();
    this.#lifecycle = "closing";
    this.#listeners.emitState({ status: "closing", reason });
    this.#detachDisconnect();
    const task = (async () => {
      try {
        await this.#writeTail;
        const reader = this.#reader;
        if (reader !== undefined) {
          try {
            await reader.cancel(reason);
          } catch (error) {
            this.#listeners.emitState({ status: "error", code: "WEB_SERIAL_CANCEL_FAILED", message: errorMessage(error) });
          }
        }
        await this.#readTask;
        this.#readTask = undefined;
        if (this.#portOpened) await this.#closePort("WEB_SERIAL_CLOSE_FAILED");
        this.#lifecycle = "closed";
        this.#listeners.emitState({ status: "closed", reason });
      } finally {
        this.#closeTask = undefined;
      }
    })();
    this.#closeTask = task;
    return task;
  }

  async #closeAfterReadLoop(reason: TransportCloseReason): Promise<void> {
    this.#lifecycle = "closing";
    this.#listeners.emitState({ status: "closing", reason });
    this.#detachDisconnect();
    try {
      await this.#writeTail;
      if (this.#portOpened) await this.#closePort("WEB_SERIAL_CLOSE_FAILED");
    } catch (error) {
      this.#reportUnexpectedCloseFailure(error);
      return;
    }
    this.#lifecycle = "closed";
    this.#listeners.emitState({ status: "closed", reason });
  }

  async #closePort(code: string): Promise<void> {
    try {
      await this.#port.close();
      this.#portOpened = false;
    } catch (error) {
      const operationError = new TransportOperationError(code, errorMessage(error), { cause: error });
      this.#lifecycle = "error";
      this.#listeners.emitState({ status: "error", code: operationError.code, message: operationError.message });
      throw operationError;
    }
  }

  #reportUnexpectedCloseFailure(error: unknown): void {
    if (error instanceof TransportOperationError) return;
    this.#lifecycle = "error";
    this.#listeners.emitState({
      status: "error",
      code: "WEB_SERIAL_CLOSE_FAILED",
      message: errorMessage(error)
    });
  }

  #attachDisconnect(): void {
    if (this.#disconnectAttached) return;
    this.#port.addEventListener?.("disconnect", this.#disconnectListener);
    this.#disconnectAttached = true;
  }

  #detachDisconnect(): void {
    if (!this.#disconnectAttached) return;
    this.#port.removeEventListener?.("disconnect", this.#disconnectListener);
    this.#disconnectAttached = false;
  }
}
