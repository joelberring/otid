import { EventEmitter } from "node:events";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import { readValidatedCapture } from "../src/capture-session.js";
import { runCaptureCommand } from "../src/capture-command.js";
import type {
  SerialDriver,
  SerialPortHandle,
  SerialPortOpenOptions
} from "../src/node-serial-transport.js";

type Listener = (...args: unknown[]) => void;

class FakeCapturePort implements SerialPortHandle {
  isOpen = false;
  readonly #listeners = new Map<string, Set<Listener>>();

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
  }

  close(callback: (error: Error | null) => void): void {
    this.isOpen = false;
    this.emit("close");
    callback(null);
  }

  write(_bytes: Uint8Array, callback: (error?: Error | null) => void): boolean {
    callback(null);
    return true;
  }

  drain(callback: (error?: Error | null) => void): void {
    callback(null);
  }

  emit(event: "open" | "data" | "error" | "close", ...args: unknown[]): void {
    for (const listener of [...(this.#listeners.get(event) ?? [])]) listener(...args);
  }
}

class FakeCaptureDriver implements SerialDriver {
  readonly port = new FakeCapturePort();
  readonly options: SerialPortOpenOptions[] = [];

  async list() {
    return [{ path: "/dev/cu.fake", vendorId: "10c4", productId: "ea60" }];
  }

  create(options: SerialPortOpenOptions): SerialPortHandle {
    this.options.push(options);
    return this.port;
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

describe("runCaptureCommand", () => {
  it("captures fake RX and a constrained stdin marker, then finalizes on SIGINT", async () => {
    const driver = new FakeCaptureDriver();
    const input = new PassThrough();
    const signals = new EventEmitter();
    let status = "";
    let resolveCapturing: (() => void) | undefined;
    const capturing = new Promise<void>((resolve) => {
      resolveCapturing = resolve;
    });
    const statusOutput = new Writable({
      write(chunk: unknown, _encoding, callback) {
        if (!(chunk instanceof Uint8Array)) {
          callback(new Error("Expected byte output"));
          return;
        }
        status += Buffer.from(chunk).toString("utf8");
        if (status.includes('"status":"capturing"')) resolveCapturing?.();
        callback();
      }
    });
    const output = await mkdtemp(path.join(os.tmpdir(), "otid-capture-command-"));
    const pending = runCaptureCommand(
      {
        port: "/dev/cu.fake",
        baudRate: 38_400,
        outputDirectory: output,
        allowRepositoryOutput: false
      },
      {
        driver,
        input,
        statusOutput,
        currentDirectory: process.cwd(),
        signalEmitter: signals
      }
    );

    await Promise.race([
      capturing,
      pending.then(() => Promise.reject(new Error("Capture ended before it opened")))
    ]);
    driver.port.emit("data", Uint8Array.from([1, 2, 3]));
    input.write("card-inserted\n");
    await flushPromises();
    signals.emit("SIGINT");
    const finalized = await pending;
    const capture = await readValidatedCapture(finalized.manifestPath);

    expect(capture.manifest.status).toBe("complete");
    expect(capture.manifest.transport).toEqual({
      kind: "node-serial",
      path: "/dev/cu.fake",
      baudRate: 38_400,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
      vendorId: 0x10c4,
      productId: 0xea60
    });
    expect(capture.manifest.byteEventCount).toBe(1);
    expect(capture.manifest.markerCount).toBe(1);
    expect([...capture.traffic]).toEqual([1, 2, 3]);
    expect(status).toContain('"rawBytesPrinted":false');
    expect(status).not.toContain("AQID");
  });

  it("keeps error completion status when an error is followed by detach", async () => {
    const driver = new FakeCaptureDriver();
    const input = new PassThrough();
    const signals = new EventEmitter();
    let resolveCapturing: (() => void) | undefined;
    const capturing = new Promise<void>((resolve) => {
      resolveCapturing = resolve;
    });
    const statusOutput = new Writable({
      write(chunk: unknown, _encoding, callback) {
        if (chunk instanceof Uint8Array && Buffer.from(chunk).toString("utf8").includes('"status":"capturing"')) {
          resolveCapturing?.();
        }
        callback();
      }
    });
    const output = await mkdtemp(path.join(os.tmpdir(), "otid-capture-error-close-"));
    const pending = runCaptureCommand(
      {
        port: "/dev/cu.fake",
        baudRate: 38_400,
        outputDirectory: output,
        allowRepositoryOutput: false
      },
      {
        driver,
        input,
        statusOutput,
        currentDirectory: process.cwd(),
        signalEmitter: signals
      }
    );

    await capturing;
    driver.port.emit("error", new Error("native I/O failed"));
    driver.port.isOpen = false;
    driver.port.emit("close", new Error("device detached"));
    await expect(pending).rejects.toThrow("SERIAL_IO_ERROR: native I/O failed");

    const entries = await readdir(output, { withFileTypes: true });
    const finalizedDirectory = entries.find((entry) => entry.isDirectory() && !entry.name.endsWith(".partial"));
    expect(finalizedDirectory).toBeDefined();
    const capture = await readValidatedCapture(
      path.join(output, finalizedDirectory!.name, "session.json")
    );
    expect(capture.manifest.status).toBe("error");
    expect(capture.wal.at(-1)).toMatchObject({ type: "marker", marker: "cable-detached" });
  });
});
