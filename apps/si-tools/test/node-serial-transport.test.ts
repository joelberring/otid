import { describe, expect, it } from "vitest";

import {
  NodeSerialTransport,
  type SerialDriver,
  type SerialPortHandle,
  type SerialPortInfo,
  type SerialPortOpenOptions
} from "../src/node-serial-transport.js";

type Listener = (...args: unknown[]) => void;

class FakePort implements SerialPortHandle {
  isOpen = false;
  readonly written: Uint8Array[] = [];
  readonly #listeners = new Map<string, Set<Listener>>();
  #writeCallback: ((error?: Error | null) => void) | undefined;
  #drainCallback: ((error?: Error | null) => void) | undefined;

  on(event: "open" | "data" | "error" | "close", listener: Listener): this {
    const listeners = this.#listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.#listeners.set(event, listeners);
    return this;
  }

  off(event: "open" | "data" | "error" | "close", listener: Listener): this {
    this.#listeners.get(event)?.delete(listener);
    return this;
  }

  open(callback: (error: Error | null) => void): void {
    this.isOpen = true;
    callback(null);
    this.emit("open");
  }

  close(callback: (error: Error | null) => void): void {
    this.isOpen = false;
    this.emit("close");
    callback(null);
  }

  write(bytes: Uint8Array, callback: (error?: Error | null) => void): boolean {
    this.written.push(Uint8Array.from(bytes));
    this.#writeCallback = callback;
    return true;
  }

  drain(callback: (error?: Error | null) => void): void {
    this.#drainCallback = callback;
  }

  completeWrite(error?: Error): void {
    const callback = this.#writeCallback;
    this.#writeCallback = undefined;
    callback?.(error);
  }

  completeDrain(error?: Error): void {
    const callback = this.#drainCallback;
    this.#drainCallback = undefined;
    callback?.(error);
  }

  emit(event: "open" | "data" | "error" | "close", ...args: unknown[]): void {
    for (const listener of [...(this.#listeners.get(event) ?? [])]) listener(...args);
  }
}

class FakeDriver implements SerialDriver {
  readonly port = new FakePort();
  readonly options: SerialPortOpenOptions[] = [];
  ports: readonly SerialPortInfo[] = [];

  async list(): Promise<readonly SerialPortInfo[]> {
    return this.ports;
  }

  create(options: SerialPortOpenOptions): SerialPortHandle {
    this.options.push(options);
    return this.port;
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("NodeSerialTransport", () => {
  it("opens with explicit locked 8N1 options and closes without a false detach", async () => {
    const driver = new FakeDriver();
    const transport = new NodeSerialTransport({ path: "/dev/cu.test", baudRate: 38_400, driver });
    const states: Array<{ status: string; reason?: string }> = [];
    transport.onState((state) => states.push(state));

    await transport.open();
    await transport.open();
    await transport.close();

    expect(driver.options).toEqual([{
      path: "/dev/cu.test",
      baudRate: 38_400,
      autoOpen: false,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      rtscts: false,
      lock: true
    }]);
    expect(states).toEqual([
      { status: "closed", reason: "initial" },
      { status: "opening" },
      { status: "open" },
      { status: "closing", reason: "requested" },
      { status: "closed", reason: "requested" }
    ]);
  });

  it("preserves native read chunk boundaries and gives every consumer an owned copy", async () => {
    const driver = new FakeDriver();
    const transport = new NodeSerialTransport({ path: "/dev/cu.test", baudRate: 4_800, driver });
    const first: Uint8Array[] = [];
    const second: Uint8Array[] = [];
    transport.onBytes((chunk) => {
      first.push(chunk);
      chunk[0] = 255;
    });
    transport.onBytes((chunk) => second.push(chunk));
    await transport.open();

    const source = Uint8Array.from([1, 2, 3]);
    driver.port.emit("data", source);
    source[1] = 99;

    expect([...first[0]!]).toEqual([255, 2, 3]);
    expect([...second[0]!]).toEqual([1, 2, 3]);
  });

  it("does not resolve write until write and drain both finish", async () => {
    const driver = new FakeDriver();
    const transport = new NodeSerialTransport({ path: "/dev/cu.test", baudRate: 115_200, driver });
    await transport.open();
    let resolved = false;
    const pending = transport.write(Uint8Array.from([7, 8])).then(() => {
      resolved = true;
    });
    await flushPromises();
    expect(resolved).toBe(false);
    driver.port.completeWrite();
    await flushPromises();
    expect(resolved).toBe(false);
    driver.port.completeDrain();
    await pending;
    expect(resolved).toBe(true);
    expect([...driver.port.written[0]!]).toEqual([7, 8]);
  });

  it("rejects an in-flight write on asynchronous native error", async () => {
    const driver = new FakeDriver();
    const transport = new NodeSerialTransport({ path: "/dev/cu.test", baudRate: 115_200, driver });
    const states: string[] = [];
    transport.onState((state) => states.push(state.status));
    await transport.open();
    const pending = transport.write(Uint8Array.from([1]));
    await flushPromises();
    driver.port.emit("error", new Error("write failed"));
    await expect(pending).rejects.toThrow("write failed");
    expect(states.at(-1)).toBe("error");
  });

  it("maps an unexpected close to detached then closed/detached", async () => {
    const driver = new FakeDriver();
    const transport = new NodeSerialTransport({ path: "/dev/cu.test", baudRate: 9_600, driver });
    const states: Array<{ status: string; reason?: string }> = [];
    transport.onState((state) => states.push(state));
    await transport.open();
    driver.port.isOpen = false;
    driver.port.emit("close", new Error("unplugged"));
    expect(states.slice(-2)).toEqual([
      { status: "detached", message: "unplugged" },
      { status: "closed", reason: "detached" }
    ]);
  });
});
