import { describe, expect, it } from "vitest";
import {
  WebSerialTransport,
  type TransportState,
  type WebSerialPortLike,
  type WebSerialReadResult,
  type WebSerialReaderLike,
  type WebSerialWriterLike
} from "../src";

interface PendingRead {
  resolve(result: WebSerialReadResult): void;
  reject(error: unknown): void;
}

class MockReader implements WebSerialReaderLike {
  pending: PendingRead | undefined;
  cancelCount = 0;
  releaseCount = 0;

  read(): Promise<WebSerialReadResult> {
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
    });
  }

  async cancel(): Promise<void> {
    this.cancelCount += 1;
    this.pending?.resolve({ done: true });
    this.pending = undefined;
  }

  releaseLock(): void {
    this.releaseCount += 1;
  }

  push(bytes: Uint8Array): void {
    const pending = this.pending;
    this.pending = undefined;
    if (pending === undefined) throw new Error("Ingen väntande read");
    pending.resolve({ done: false, value: bytes });
  }

  finish(): void {
    const pending = this.pending;
    this.pending = undefined;
    if (pending === undefined) throw new Error("Ingen väntande read");
    pending.resolve({ done: true });
  }

  fail(error: unknown): void {
    const pending = this.pending;
    this.pending = undefined;
    if (pending === undefined) throw new Error("Ingen väntande read");
    pending.reject(error);
  }
}

class MockWriter implements WebSerialWriterLike {
  readonly writes: Uint8Array[] = [];
  releaseCount = 0;
  blocked: Promise<void> | undefined;
  releaseBlocked: (() => void) | undefined;

  async write(bytes: Uint8Array): Promise<void> {
    await (this.blocked ?? Promise.resolve());
    this.writes.push(bytes.slice());
  }

  releaseLock(): void {
    this.releaseCount += 1;
  }

  block(): void {
    this.blocked = new Promise((resolve) => {
      this.releaseBlocked = resolve;
    });
  }

  unblock(): void {
    this.releaseBlocked?.();
    this.releaseBlocked = undefined;
    this.blocked = undefined;
  }
}

class MockPort implements WebSerialPortLike {
  readonly reader = new MockReader();
  readonly writer = new MockWriter();
  readonly readable = { getReader: (): WebSerialReaderLike => this.reader };
  readonly writable = { getWriter: (): WebSerialWriterLike => this.writer };
  openCount = 0;
  closeCount = 0;
  closeError: Error | undefined;
  disconnectListener: (() => void) | undefined;

  async open(): Promise<void> {
    this.openCount += 1;
  }

  async close(): Promise<void> {
    this.closeCount += 1;
    if (this.closeError !== undefined) throw this.closeError;
  }

  addEventListener(_type: "disconnect", listener: () => void): void {
    this.disconnectListener = listener;
  }

  removeEventListener(_type: "disconnect", listener: () => void): void {
    if (this.disconnectListener === listener) this.disconnectListener = undefined;
  }

  detach(): void {
    this.disconnectListener?.();
  }
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("WebSerialTransport", () => {
  it("läser defensiva chunkkopior och stänger med cancel/release/close", async () => {
    const port = new MockPort();
    const transport = new WebSerialTransport(port, { baudRate: 38400 });
    const first: number[][] = [];
    const second: number[][] = [];
    const states: TransportState[] = [];
    transport.onBytes((chunk) => {
      first.push([...chunk]);
      chunk[0] = 0xff;
    });
    transport.onBytes((chunk) => second.push([...chunk]));
    transport.onState((state) => states.push(state));
    await transport.open();
    port.reader.push(Uint8Array.of(1, 2));
    await settle();
    await transport.close();
    expect(first).toEqual([[1, 2]]);
    expect(second).toEqual([[1, 2]]);
    expect(port.reader.cancelCount).toBe(1);
    expect(port.reader.releaseCount).toBe(1);
    expect(port.closeCount).toBe(1);
    expect(states).toEqual([
      { status: "closed", reason: "initial" },
      { status: "opening" },
      { status: "open" },
      { status: "closing", reason: "requested" },
      { status: "closed", reason: "requested" }
    ]);
  });

  it("ger aktuell state direkt och gör open idempotent", async () => {
    const port = new MockPort();
    const transport = new WebSerialTransport(port, { baudRate: 38400 });
    await transport.open();
    await transport.open();
    const lateStates: TransportState[] = [];
    transport.onState((state) => lateStates.push(state));
    expect(port.openCount).toBe(1);
    expect(lateStates).toEqual([{ status: "open" }]);
    await transport.close();
  });

  it("kopierar och serialiserar writes samt frigör writerlåset", async () => {
    const port = new MockPort();
    const transport = new WebSerialTransport(port, { baudRate: 38400 });
    await transport.open();
    const first = Uint8Array.of(1, 2);
    const firstWrite = transport.write(first);
    first.fill(9);
    await Promise.all([firstWrite, transport.write(Uint8Array.of(3))]);
    expect(port.writer.writes.map((bytes) => [...bytes])).toEqual([[1, 2], [3]]);
    expect(port.writer.releaseCount).toBe(2);
    await transport.close();
  });

  it("väntar in en blockerad writer före cancel och fysisk portstängning", async () => {
    const port = new MockPort();
    port.writer.block();
    const transport = new WebSerialTransport(port, { baudRate: 38400 });
    await transport.open();
    const write = transport.write(Uint8Array.of(7));
    await settle();
    const close = transport.close();
    await settle();
    expect(port.reader.cancelCount).toBe(0);
    expect(port.closeCount).toBe(0);
    port.writer.unblock();
    await write;
    await close;
    expect(port.reader.cancelCount).toBe(1);
    expect(port.closeCount).toBe(1);
  });

  it("avvisar close och lämnar error utan falsk closed när port.close misslyckas", async () => {
    const port = new MockPort();
    const transport = new WebSerialTransport(port, { baudRate: 38400 });
    const states: TransportState[] = [];
    transport.onState((state) => states.push(state));
    await transport.open();
    port.closeError = new Error("close boom");
    await expect(transport.close()).rejects.toMatchObject({ code: "WEB_SERIAL_CLOSE_FAILED" });
    expect(states).toContainEqual({ status: "error", code: "WEB_SERIAL_CLOSE_FAILED", message: "close boom" });
    expect(states).not.toContainEqual({ status: "closed", reason: "requested" });
    const current: TransportState[] = [];
    transport.onState((state) => current.push(state));
    expect(current).toEqual([{ status: "error", code: "WEB_SERIAL_CLOSE_FAILED", message: "close boom" }]);
    port.closeError = undefined;
    await transport.close();
    expect(states).toContainEqual({ status: "closed", reason: "requested" });
  });

  it("rapporterar detach serialiserbart och städar porten", async () => {
    const port = new MockPort();
    const transport = new WebSerialTransport(port, { baudRate: 38400 });
    const states: TransportState[] = [];
    transport.onState((state) => states.push(state));
    await transport.open();
    const detachedClosed = new Promise<void>((resolve) => {
      const unsubscribe = transport.onState((state) => {
        if (state.status === "closed" && state.reason === "detached") {
          unsubscribe();
          resolve();
        }
      });
    });
    port.detach();
    await detachedClosed;
    expect(states).toContainEqual({ status: "detached", message: "Serieporten kopplades från" });
    expect(states).toContainEqual({ status: "closed", reason: "detached" });
    expect(port.reader.cancelCount).toBe(1);
    expect(port.reader.releaseCount).toBe(1);
    expect(port.closeCount).toBe(1);
  });

  it("rapporterar läsfel utan Error-objekt och stänger", async () => {
    const port = new MockPort();
    const transport = new WebSerialTransport(port, { baudRate: 38400 });
    const states: TransportState[] = [];
    transport.onState((state) => states.push(state));
    await transport.open();
    port.reader.fail(new Error("read boom"));
    await settle();
    expect(states).toContainEqual({ status: "error", code: "WEB_SERIAL_READ_FAILED", message: "read boom" });
    expect(states).toContainEqual({ status: "closed", reason: "error" });
    expect(JSON.stringify(states)).not.toContain("stack");
  });

  it("stänger naturligt avslutad read-loop som completed", async () => {
    const port = new MockPort();
    const transport = new WebSerialTransport(port, { baudRate: 38400 });
    const states: TransportState[] = [];
    transport.onState((state) => states.push(state));
    await transport.open();
    port.reader.finish();
    await settle();
    expect(states).toContainEqual({ status: "closed", reason: "completed" });
    expect(port.reader.releaseCount).toBe(1);
    expect(port.closeCount).toBe(1);
  });

  it("väntar på aktiv writer före automatisk close efter EOF", async () => {
    const port = new MockPort();
    port.writer.block();
    const transport = new WebSerialTransport(port, { baudRate: 38400 });
    await transport.open();
    const closed = new Promise<void>((resolve) => {
      transport.onState((state) => {
        if (state.status === "closed" && state.reason === "completed") resolve();
      });
    });
    const write = transport.write(Uint8Array.of(8));
    await settle();
    port.reader.finish();
    await settle();
    expect(port.closeCount).toBe(0);
    port.writer.unblock();
    await write;
    await closed;
    expect(port.closeCount).toBe(1);
  });

  it("väntar på aktiv writer före automatisk close efter läsfel", async () => {
    const port = new MockPort();
    port.writer.block();
    const transport = new WebSerialTransport(port, { baudRate: 38400 });
    await transport.open();
    const closed = new Promise<void>((resolve) => {
      transport.onState((state) => {
        if (state.status === "closed" && state.reason === "error") resolve();
      });
    });
    const write = transport.write(Uint8Array.of(9));
    await settle();
    port.reader.fail(new Error("read while writing"));
    await settle();
    expect(port.closeCount).toBe(0);
    port.writer.unblock();
    await write;
    await closed;
    expect(port.closeCount).toBe(1);
  });
});
