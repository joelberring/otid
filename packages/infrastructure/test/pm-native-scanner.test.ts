import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureNativeScannerProcess, createNativePmScannerProbe } from "../src/pm-native-scanner";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

type SyntheticChild = EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: (signal: string) => boolean };
function childDouble(): SyntheticChild {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true)
  });
  children.push(child);
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
  return child;
}
const children: SyntheticChild[] = [];
const binary = "/synthetic/qpdf";
const directory = "/synthetic/private";
const environment = { PATH: "/usr/bin:/bin", LC_ALL: "C" };
const capture = (signal = new AbortController().signal) =>
  captureNativeScannerProcess(binary, ["--check", "input.pdf"], directory, environment, signal);

beforeEach(() => vi.mocked(spawn).mockReset());
afterEach(() => {
  for (const child of children.splice(0)) {
    child.emit("close", null, "SIGKILL");
    child.stdout.destroy(); child.stderr.destroy();
  }
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers();
});

describe("native scanner child-process boundary with synthetic processes only", () => {
  it("preserves early output and exit while passing only the supplied environment without a shell", async () => {
    const child = childDouble();
    const clock = vi.spyOn(performance, "now").mockReturnValue(1_000);
    const controller = new AbortController(), pending = capture(controller.signal);
    child.stdout.write("synthetic stdout\n"); child.stderr.write("synthetic stderr\n");
    clock.mockReturnValue(60_999);
    child.emit("close", 0, null);
    expect(await pending).toEqual({ stdout: "synthetic stdout\n", stderr: "synthetic stderr\n",
      exitCode: 0, signal: null, timedOut: false, outputTruncated: false });
    expect(spawn).toHaveBeenCalledExactlyOnceWith(binary, ["--check", "input.pdf"],
      { cwd: directory, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    controller.abort();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("marks a clean close at the monotonic deadline as timed out even before the timer runs", async () => {
    const child = childDouble(), clock = vi.spyOn(performance, "now").mockReturnValue(1_000);
    const pending = capture();
    clock.mockReturnValue(61_000);
    child.emit("close", 0, null);
    expect(await pending).toMatchObject({ exitCode: 0, signal: null, timedOut: true, outputTruncated: false });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("kills on timer expiry but waits for actual close before resolving", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const child = childDouble(), pending = capture();
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    expect(settled).toBe(false);
    child.emit("close", null, "SIGKILL");
    expect(await pending).toMatchObject({ exitCode: null, signal: "SIGKILL", timedOut: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an already-aborted call without spawning", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(capture(controller.signal)).rejects.toThrow("NATIVE_ABORTED");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("kills on caller abort and waits for close without returning clean output", async () => {
    const child = childDouble(), controller = new AbortController(), pending = capture(controller.signal);
    let settled = false;
    void pending.then(() => { settled = true; });
    controller.abort();
    await Promise.resolve();
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    expect(settled).toBe(false);
    // Even a racing normal exit must not conceal the abort.
    child.emit("close", 0, null);
    expect(await pending).toMatchObject({ stderr: "NATIVE_PROCESS_FAILED", exitCode: 0 });
  });

  it("bounds combined stdout/stderr and waits for close after killing oversized output", async () => {
    const child = childDouble(), pending = capture();
    let settled = false;
    void pending.then(() => { settled = true; });
    child.stdout.write(Buffer.alloc(128 * 1024, 65));
    child.stderr.write(Buffer.alloc(128 * 1024, 66));
    child.stdout.write(Buffer.from("overflow"));
    await Promise.resolve();
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    expect(settled).toBe(false);
    child.emit("close", null, "SIGKILL");
    const result = await pending;
    expect(result.outputTruncated).toBe(true);
    expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBe(256 * 1024);
    expect(result.stdout).not.toContain("overflow");
  });

  it("sanitizes spawn errors and waits for close rather than claiming cleanup before child termination", async () => {
    const child = childDouble(), pending = capture();
    let settled = false;
    void pending.then(() => { settled = true; });
    child.emit("error", new Error("Synthetic private diagnostic"));
    await Promise.resolve();
    expect(settled).toBe(false);
    child.emit("close", -2, null);
    expect(await pending).toEqual({ stdout: "", stderr: "NATIVE_PROCESS_FAILED", exitCode: -2,
      signal: null, timedOut: false, outputTruncated: false });
  });

  it("never allows the native factory in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createNativePmScannerProbe({ mode: "native-compatibility-probe", root: "/private/tmp/otid-pm-scanners.synthetic" }))
      .toThrow("NATIVE_PROBE_CONFIGURATION_REQUIRED");
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    { mode: "production", root: "/private/tmp/otid-pm-scanners.synthetic" },
    { mode: "native-compatibility-probe", root: "/private/tmp/otid-pm-scanners.synthetic/../other" },
    { mode: "native-compatibility-probe", root: "/private/tmp/otid-pm-scanners.synthetic", bypass: true }
  ])("rejects invalid factory configuration %# without spawning", input => {
    vi.stubEnv("NODE_ENV", "test");
    expect(() => createNativePmScannerProbe(input)).toThrow("NATIVE_PROBE_CONFIGURATION_REQUIRED");
    expect(spawn).not.toHaveBeenCalled();
  });
});
