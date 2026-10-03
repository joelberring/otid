import { createInterface } from "node:readline";
import path from "node:path";
import type { Readable, Writable } from "node:stream";

import type { CaptureCompletionStatus, CaptureMarkerKind, TransportState } from "@o-tid/device-transport";

import { assertCaptureOutputAllowed, findWorkspaceRoot, type CaptureCommandArguments } from "./cli-arguments.js";
import { CaptureSessionWriter, type FinalizedCapture } from "./capture-session.js";
import { NodeSerialTransport, listSerialPorts, type SerialDriver } from "./node-serial-transport.js";

export interface CaptureCommandDependencies {
  readonly driver: SerialDriver;
  readonly input?: Readable;
  readonly statusOutput?: Writable;
  readonly currentDirectory?: string;
  readonly signalEmitter?: CaptureSignalEmitter;
}

export interface CaptureSignalEmitter {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

function parseUsbId(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value.replace(/^0x/u, ""), 16);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 0xffff ? parsed : null;
}

function captureMarker(line: string): CaptureMarkerKind {
  if (line === "card-inserted" || line === "card-removed" || line === "cable-detached") return line;
  throw new Error("stdin markers must be card-inserted, card-removed, or cable-detached");
}

function statusLine(output: Writable | undefined, value: unknown): void {
  output?.write(`${JSON.stringify(value)}\n`);
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export async function runCaptureCommand(
  args: CaptureCommandArguments,
  dependencies: CaptureCommandDependencies
): Promise<FinalizedCapture> {
  const currentDirectory = dependencies.currentDirectory ?? process.cwd();
  const workspaceRoot = await findWorkspaceRoot(currentDirectory);
  await assertCaptureOutputAllowed(args.outputDirectory, workspaceRoot, args.allowRepositoryOutput);

  const listedPorts = await listSerialPorts(dependencies.driver);
  const selectedPort = listedPorts.find((port) => port.path === args.port);
  const writer = await CaptureSessionWriter.create({
    outputDirectory: path.resolve(currentDirectory, args.outputDirectory),
    transport: {
      kind: "node-serial",
      path: args.port,
      baudRate: args.baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
      vendorId: parseUsbId(selectedPort?.vendorId),
      productId: parseUsbId(selectedPort?.productId)
    },
    synthetic: false
  });
  statusLine(dependencies.statusOutput, {
    status: "capture-partial-created",
    partialDirectory: writer.partialDirectory,
    rawBytesPrinted: false
  });

  const transport = new NodeSerialTransport({ path: args.port, baudRate: args.baudRate, driver: dependencies.driver });
  let queue: Promise<void> = Promise.resolve();
  let stopStatus: CaptureCompletionStatus = "complete";
  let stopError: unknown;
  let finalizedCapture = false;
  let requestStop: (() => void) | undefined;

  const enqueue = (operation: () => Promise<void>): void => {
    queue = queue.then(operation).catch((error: unknown) => {
      stopStatus = "error";
      stopError = error;
      requestStop?.();
    });
  };
  const unsubscribeBytes = transport.onBytes((chunk) => enqueue(() => writer.recordChunk("rx", chunk)));
  const unsubscribeState = transport.onState((state: TransportState) => {
    if (state.status === "detached") {
      enqueue(() => writer.recordMarker("cable-detached"));
      if (stopStatus !== "error") stopStatus = "interrupted";
      requestStop?.();
    } else if (state.status === "error") {
      stopStatus = "error";
      stopError = new Error(`${state.code}: ${state.message}`);
      requestStop?.();
    }
  });

  const input = dependencies.input ?? process.stdin;
  const markerInput = createInterface({ input, crlfDelay: Infinity, terminal: false });
  markerInput.on("line", (line) => {
    try {
      const marker = captureMarker(line.trim());
      enqueue(() => writer.recordMarker(marker));
    } catch (error) {
      stopStatus = "error";
      stopError = error;
      requestStop?.();
    }
  });

  const signalEmitter = dependencies.signalEmitter ?? process;
  let resolveStop: (() => void) | undefined;
  const stopPromise = new Promise<void>((resolve) => {
    resolveStop = resolve;
    requestStop = resolve;
  });
  const onSignal = (): void => resolveStop?.();
  signalEmitter.once("SIGINT", onSignal);
  signalEmitter.once("SIGTERM", onSignal);

  try {
    await transport.open();
    statusLine(dependencies.statusOutput, {
      status: "capturing",
      port: args.port,
      baudRate: args.baudRate,
      acceptedMarkers: ["card-inserted", "card-removed", "cable-detached"],
      rawBytesPrinted: false
    });
    await stopPromise;
    await transport.close();
    await queue;
    const finalized = await writer.finalize(stopStatus);
    finalizedCapture = true;
    statusLine(dependencies.statusOutput, {
      status: "capture-finalized",
      captureStatus: finalized.capture.manifest.status,
      manifestPath: finalized.manifestPath,
      eventCount: finalized.capture.manifest.eventCount,
      byteCount: finalized.capture.manifest.byteCount,
      trafficSha256: finalized.capture.manifest.artifacts.traffic.sha256,
      rawBytesPrinted: false
    });
    if (stopError) throw asError(stopError);
    return finalized;
  } catch (error) {
    await transport.close().catch(() => undefined);
    await queue.catch(() => undefined);
    if (!stopError) stopError = error;
    if (!finalizedCapture) {
      try {
        const finalized = await writer.finalize("error");
        finalizedCapture = true;
        statusLine(dependencies.statusOutput, {
          status: "capture-finalized",
          captureStatus: "error",
          manifestPath: finalized.manifestPath,
          rawBytesPrinted: false
        });
      } catch {
        await writer.abort().catch(() => undefined);
      }
    }
    throw asError(stopError);
  } finally {
    unsubscribeBytes();
    unsubscribeState();
    markerInput.close();
    signalEmitter.off("SIGINT", onSignal);
    signalEmitter.off("SIGTERM", onSignal);
  }
}
