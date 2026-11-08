import type { ByteTransport } from "@o-tid/device-transport";
import {
  StationReadSession, StationWriteSession, type StationReport, type StationWritePlan, type StationWriteReport
} from "@o-tid/sportident";

/**
 * Ägaren 2026-11-08: kör `StationReadSession` (utläsning) eller `StationWriteSession` (inställning) mot en ansluten
 * huvudstation (Web Serial). Tidsgräns per svar; all trafik sparas för råloggen. Ger rapporten, eller ett fel som kan visas.
 */
export type StationReadProblem = "no-station" | "timeout" | "nak" | "unexpected" | "transport" | "invalid-plan";
export class StationReadError extends Error {
  constructor(readonly problem: StationReadProblem) { super(problem); }
}
export interface TrafficEntry { readonly at: number; readonly direction: "in" | "out"; readonly hex: string }
const hex = (bytes: Uint8Array) => [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join(" ");

type Output<E> = { readonly send: readonly Uint8Array[]; readonly events: readonly E[] };
interface Session<E> { start(): Output<E>; receive(chunk: Uint8Array): Output<E>; timeout(): Output<E>; readonly expectsResponse: boolean }
type Settle<R> = (event: unknown) => { done: R } | { error: StationReadProblem } | { progress: [number, number] } | undefined;

function run<E, R>(transport: ByteTransport, session: Session<E>, settle: Settle<R>, options: { timeoutMs?: number;
  onProgress?: (done: number, total: number) => void; traffic: TrafficEntry[] }): Promise<R> {
  const timeoutMs = options.timeoutMs ?? 2000;
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    let unsubscribe = () => {};
    const finish = (error?: StationReadError, value?: R) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      if (value !== undefined) resolve(value); else reject(error ?? new StationReadError("unexpected"));
    };
    const handle = (output: Output<E>) => {
      for (const bytes of output.send) {
        options.traffic.push({ at: Date.now(), direction: "out", hex: hex(bytes) });
        transport.write(bytes).catch(() => finish(new StationReadError("transport")));
      }
      for (const event of output.events) {
        const settled = settle(event);
        if (!settled) continue;
        if ("progress" in settled) options.onProgress?.(...settled.progress);
        else if ("done" in settled) finish(undefined, settled.done);
        else finish(new StationReadError(settled.error));
      }
      if (timer) clearTimeout(timer);
      if (!finished && session.expectsResponse) timer = setTimeout(() => handle(session.timeout()), timeoutMs);
    };
    unsubscribe = transport.onBytes(chunk => {
      options.traffic.push({ at: Date.now(), direction: "in", hex: hex(chunk) });
      handle(session.receive(chunk));
    });
    handle(session.start());
  });
}

export function readStation(transport: ByteTransport, options: { remote: boolean; timeoutMs?: number;
  onProgress?: (done: number, total: number) => void; traffic: TrafficEntry[] }): Promise<{ report: StationReport }> {
  return run(transport, new StationReadSession({ remote: options.remote }), event => {
    const e = event as { type: string; done?: number; total?: number; report?: StationReport; reason?: StationReadProblem };
    if (e.type === "progress") return { progress: [e.done!, e.total!] };
    if (e.type === "station-read") return { done: { report: e.report! } };
    if (e.type === "no-station") return { error: "no-station" };
    if (e.type === "read-failed") return { error: e.reason! };
    return undefined;
  }, options);
}

export function writeStation(transport: ByteTransport, plan: StationWritePlan, options: { remote: boolean; timeoutMs?: number; traffic: TrafficEntry[] })
  : Promise<StationWriteReport> {
  return run(transport, new StationWriteSession(plan, { remote: options.remote }), event => {
    const e = event as { type: string; report?: StationWriteReport; reason?: StationReadProblem };
    if (e.type === "station-written") return { done: e.report! };
    if (e.type === "no-station") return { error: "no-station" };
    if (e.type === "write-failed") return { error: e.reason! };
    return undefined;
  }, options);
}
