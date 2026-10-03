import type {
  ByteTransport,
  TransportState,
  Unsubscribe
} from "@o-tid/device-transport";

export interface SerialPortInfo {
  readonly path: string;
  readonly manufacturer?: string;
  readonly serialNumber?: string;
  readonly pnpId?: string;
  readonly locationId?: string;
  readonly productId?: string;
  readonly vendorId?: string;
}

export interface SerialPortOpenOptions {
  readonly path: string;
  readonly baudRate: number;
  readonly autoOpen: false;
  readonly dataBits: 8;
  readonly stopBits: 1;
  readonly parity: "none";
  readonly rtscts: false;
  readonly lock: true;
}

type PortEvent = "open" | "data" | "error" | "close";
type PortListener = (...args: unknown[]) => void;

export interface SerialPortHandle {
  readonly isOpen: boolean;
  on(event: PortEvent, listener: PortListener): this;
  off(event: PortEvent, listener: PortListener): this;
  open(callback: (error: Error | null) => void): void;
  close(callback: (error: Error | null) => void): void;
  write(bytes: Uint8Array, callback: (error?: Error | null) => void): boolean;
  drain(callback: (error?: Error | null) => void): void;
}

export interface SerialDriver {
  list(): Promise<readonly SerialPortInfo[]>;
  create(options: SerialPortOpenOptions): SerialPortHandle;
}

export interface NodeSerialTransportOptions {
  readonly path: string;
  readonly baudRate: number;
  readonly driver: SerialDriver;
}

function errorState(code: string, error: unknown): TransportState {
  return {
    status: "error",
    code,
    message: error instanceof Error ? error.message : String(error)
  };
}

function removeOnce<T>(set: Set<T>, item: T): void {
  set.delete(item);
}

function asError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(typeof value === "string" ? value : fallback);
}

export class NodeSerialTransport implements ByteTransport {
  readonly kind = "node-serial" as const;

  readonly #path: string;
  readonly #baudRate: number;
  readonly #driver: SerialDriver;
  readonly #byteHandlers = new Set<(chunk: Uint8Array) => void>();
  readonly #stateHandlers = new Set<(state: TransportState) => void>();
  #state: TransportState = { status: "closed", reason: "initial" };
  #port: SerialPortHandle | undefined;
  #closePromise: Promise<void> | undefined;
  #writeTail: Promise<void> = Promise.resolve();

  constructor(options: NodeSerialTransportOptions) {
    if (!options.path) throw new TypeError("Serial port path is required");
    if (!Number.isSafeInteger(options.baudRate) || options.baudRate <= 0) {
      throw new TypeError("Serial baud rate must be a positive integer");
    }
    this.#path = options.path;
    this.#baudRate = options.baudRate;
    this.#driver = options.driver;
  }

  onBytes(handler: (chunk: Uint8Array) => void): Unsubscribe {
    this.#byteHandlers.add(handler);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      removeOnce(this.#byteHandlers, handler);
    };
  }

  onState(handler: (state: TransportState) => void): Unsubscribe {
    this.#stateHandlers.add(handler);
    handler(this.#state);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      removeOnce(this.#stateHandlers, handler);
    };
  }

  async open(): Promise<void> {
    if (this.#state.status === "open") return;
    if (this.#state.status === "opening" || this.#state.status === "closing") {
      throw new Error(`Cannot open serial transport while ${this.#state.status}`);
    }

    this.#setState({ status: "opening" });
    const port = this.#driver.create({
      path: this.#path,
      baudRate: this.#baudRate,
      autoOpen: false,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      rtscts: false,
      lock: true
    });
    this.#port = port;
    port.on("data", this.#handleData as PortListener);
    port.on("error", this.#handlePortError as PortListener);
    port.on("close", this.#handlePortClose as PortListener);

    try {
      await new Promise<void>((resolve, reject) => {
        port.open((error) => (error ? reject(error) : resolve()));
      });
      if (this.#port !== port) throw new Error("Serial port changed while opening");
      this.#setState({ status: "open" });
    } catch (error) {
      this.#setState(errorState("SERIAL_OPEN_FAILED", error));
      this.#detachPort(port);
      this.#port = undefined;
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.#state.status === "closed" && !this.#port) return;
    if (this.#closePromise) return this.#closePromise;

    const port = this.#port;
    if (!port) {
      this.#setState({ status: "closed", reason: "requested" });
      return;
    }

    this.#setState({ status: "closing", reason: "requested" });
    const closePromise = (async () => {
      await this.#writeTail.catch(() => undefined);
      if (port.isOpen) {
        await new Promise<void>((resolve, reject) => {
          port.close((error) => (error ? reject(error) : resolve()));
        });
      }
      if (this.#port === port) {
        this.#detachPort(port);
        this.#port = undefined;
      }
      this.#setState({ status: "closed", reason: "requested" });
    })().catch((error: unknown) => {
      this.#setState(errorState("SERIAL_CLOSE_FAILED", error));
      throw error;
    }).finally(() => {
      this.#closePromise = undefined;
    });
    this.#closePromise = closePromise;
    return closePromise;
  }

  async write(bytes: Uint8Array): Promise<void> {
    const ownedBytes = Uint8Array.from(bytes);
    const operation = this.#writeTail.then(async () => {
      const port = this.#port;
      if (!port || this.#state.status !== "open" || !port.isOpen) {
        throw new Error("Serial port is not open");
      }
      await this.#writeAndDrain(port, ownedBytes);
    });
    this.#writeTail = operation.catch(() => undefined);
    return operation;
  }

  async #writeAndDrain(port: SerialPortHandle, bytes: Uint8Array): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const cleanup = (): void => {
          port.off("error", onError);
          port.off("close", onClose);
        };
        const settle = (error?: unknown): void => {
          if (settled) return;
          settled = true;
          cleanup();
          if (error) reject(asError(error, "Serial write failed"));
          else resolve();
        };
        const onError: PortListener = (error) => settle(error ?? new Error("Serial write failed"));
        const onClose: PortListener = (error) => settle(error ?? new Error("Serial port closed during write"));
        port.on("error", onError);
        port.on("close", onClose);
        port.write(bytes, (writeError) => {
          if (writeError) {
            settle(writeError);
            return;
          }
          port.drain((drainError) => settle(drainError ?? undefined));
        });
      });
    } catch (error) {
      this.#setState(errorState("SERIAL_WRITE_FAILED", error));
      throw error;
    }
  }

  readonly #handleData = (value: unknown): void => {
    if (!(value instanceof Uint8Array)) {
      this.#setState(errorState("SERIAL_INVALID_CHUNK", "Serial driver emitted non-byte data"));
      return;
    }
    const ownedChunk = Uint8Array.from(value);
    for (const handler of [...this.#byteHandlers]) {
      handler(Uint8Array.from(ownedChunk));
    }
  };

  readonly #handlePortError = (error: unknown): void => {
    this.#setState(errorState("SERIAL_IO_ERROR", error));
  };

  readonly #handlePortClose = (error: unknown): void => {
    const port = this.#port;
    if (!port) return;
    const wasClosing = this.#state.status === "closing";
    if (!wasClosing) {
      this.#setState({
        status: "detached",
        message: error instanceof Error ? error.message : "Serial port closed unexpectedly"
      });
    }
    this.#detachPort(port);
    this.#port = undefined;
    if (!wasClosing) this.#setState({ status: "closed", reason: "detached" });
  };

  #detachPort(port: SerialPortHandle): void {
    port.off("data", this.#handleData as PortListener);
    port.off("error", this.#handlePortError as PortListener);
    port.off("close", this.#handlePortClose as PortListener);
  }

  #setState(state: TransportState): void {
    this.#state = state;
    for (const handler of [...this.#stateHandlers]) handler(state);
  }
}

export async function listSerialPorts(driver: SerialDriver): Promise<readonly SerialPortInfo[]> {
  const ports = await driver.list();
  return [...ports].sort((left, right) => left.path.localeCompare(right.path));
}
