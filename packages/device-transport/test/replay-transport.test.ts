import { describe, expect, it } from "vitest";
import {
  ReplayTransport,
  TransportOperationError,
  type ReplayScheduleHandle,
  type ReplayScheduler,
  type TransportState
} from "../src";
import { makeCapture } from "./capture-fixture";

class ManualScheduler implements ReplayScheduler {
  readonly tasks: Array<{ delay: number; cancelled: boolean; run: () => void }> = [];

  schedule(delayMicroseconds: number, task: () => void): ReplayScheduleHandle {
    const scheduled = { delay: delayMicroseconds, cancelled: false, run: task };
    this.tasks.push(scheduled);
    return { cancel: () => { scheduled.cancelled = true; } };
  }
}

const events = [
  { type: "marker", marker: "card-inserted", at: 100 },
  { type: "bytes", direction: "rx", at: 150, bytes: [1, 2] },
  { type: "bytes", direction: "tx", at: 180, bytes: [9] },
  { type: "bytes", direction: "rx", at: 250, bytes: [3] },
  { type: "marker", marker: "card-removed", at: 300 }
] as const;

describe("ReplayTransport", () => {
  it("emitterar endast rx med exakt chunkindelning och separata kopior", async () => {
    const transport = new ReplayTransport(makeCapture(events));
    const first: number[][] = [];
    const second: number[][] = [];
    transport.onBytes((chunk) => {
      first.push([...chunk]);
      chunk[0] = 0xff;
    });
    transport.onBytes((chunk) => second.push([...chunk]));
    await transport.open();
    expect(first).toEqual([[1, 2], [3]]);
    expect(second).toEqual([[1, 2], [3]]);
  });

  it("ger tydliga state-events och idempotent unsubscribe/close", async () => {
    const transport = new ReplayTransport(makeCapture(events));
    const states: TransportState[] = [];
    const unsubscribe = transport.onState((state) => states.push(state));
    await transport.open();
    await transport.close();
    await transport.close();
    unsubscribe();
    unsubscribe();
    expect(states).toEqual([
      { status: "closed", reason: "initial" },
      { status: "opening" },
      { status: "open" },
      { status: "closing", reason: "requested" },
      { status: "closed", reason: "requested" }
    ]);
  });

  it("ger aktuell state direkt och gör open idempotent utan ny replay", async () => {
    const transport = new ReplayTransport(makeCapture(events));
    const chunks: number[][] = [];
    transport.onBytes((chunk) => chunks.push([...chunk]));
    await transport.open();
    await transport.open();
    const lateStates: TransportState[] = [];
    transport.onState((state) => lateStates.push(state));
    expect(chunks).toEqual([[1, 2], [3]]);
    expect(lateStates).toEqual([{ status: "open" }]);
    await transport.close();
  });

  it("validerar hela capturen före första byte", async () => {
    const capture = makeCapture(events);
    capture.traffic[0] = 0xff;
    const transport = new ReplayTransport(capture);
    const chunks: Uint8Array[] = [];
    const states: TransportState[] = [];
    transport.onBytes((chunk) => chunks.push(chunk));
    transport.onState((state) => states.push(state));
    await expect(transport.open()).rejects.toThrow(/SHA-256/);
    expect(chunks).toHaveLength(0);
    expect(states.map((state) => state.status)).toEqual(["closed", "opening", "error", "closed"]);
  });

  it("använder inspelade relativa tider och kan avbryta alla callbacks", async () => {
    const scheduler = new ManualScheduler();
    const capture = makeCapture(events);
    const transport = new ReplayTransport(capture, { timing: { mode: "recorded", scheduler } });
    const chunks: number[][] = [];
    transport.onBytes((chunk) => chunks.push([...chunk]));
    await transport.open();
    expect(scheduler.tasks.map((task) => task.delay)).toEqual([50, 150]);
    capture.traffic.fill(0xff);
    scheduler.tasks[0]?.run();
    expect(chunks).toEqual([[1, 2]]);
    await transport.close();
    scheduler.tasks[1]?.run();
    expect(scheduler.tasks.every((task) => task.cancelled)).toBe(true);
    expect(chunks).toEqual([[1, 2]]);
  });

  it("matchar inspelade tx-chunkar och avvisar fel samt skrivning stängd", async () => {
    const transport = new ReplayTransport(makeCapture(events));
    await expect(transport.write(Uint8Array.of(9))).rejects.toBeInstanceOf(TransportOperationError);
    await transport.open();
    const bytes = Uint8Array.of(9);
    await expect(transport.write(Uint8Array.of(8))).rejects.toMatchObject({ code: "REPLAY_WRITE_MISMATCH" });
    const write = transport.write(bytes);
    bytes[0] = 7;
    await expect(write).resolves.toBeUndefined();
    await expect(transport.write(Uint8Array.of(9))).rejects.toMatchObject({ code: "UNEXPECTED_REPLAY_WRITE" });
    await transport.close();
    await expect(transport.write(Uint8Array.of(9))).rejects.toMatchObject({ code: "REPLAY_NOT_OPEN" });
  });
});
