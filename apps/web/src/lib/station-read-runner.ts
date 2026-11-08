import type { ByteTransport } from "@o-tid/device-transport";
import { StationReadSession, type StationReport } from "@o-tid/sportident";

/**
 * Ägaren 2026-11-08: kör `StationReadSession` mot en ansluten huvudstation (Web Serial). Tidsgräns per svar; all trafik
 * sparas för råloggen. Ger rapporten, eller ett fel som kan visas.
 */
export type StationReadProblem = "no-station" | "timeout" | "nak" | "unexpected" | "transport";
export class StationReadError extends Error {
  constructor(readonly problem: StationReadProblem) { super(problem); }
}
export interface TrafficEntry { readonly at: number; readonly direction: "in" | "out"; readonly hex: string }
const hex = (bytes: Uint8Array) => [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join(" ");

export async function readStation(transport: ByteTransport, options: { remote: boolean; timeoutMs?: number;
  onProgress?: (done: number, total: number) => void; traffic: TrafficEntry[] }): Promise<{ report: StationReport; frames: readonly Uint8Array[] }> {
  const session = new StationReadSession({ remote: options.remote });
  const timeoutMs = options.timeoutMs ?? 2000;
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const finish = (error?: StationReadError, report?: StationReport) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      if (report) resolve({ report, frames: [...session.frames] }); else reject(error ?? new StationReadError("unexpected"));
    };
    const handle = (output: ReturnType<StationReadSession["receive"]>) => {
      for (const bytes of output.send) {
        options.traffic.push({ at: Date.now(), direction: "out", hex: hex(bytes) });
        transport.write(bytes).catch(() => finish(new StationReadError("transport")));
      }
      for (const event of output.events) {
        if (event.type === "progress") options.onProgress?.(event.done, event.total);
        else if (event.type === "station-read") finish(undefined, event.report);
        else if (event.type === "no-station") finish(new StationReadError("no-station"));
        else if (event.type === "read-failed") finish(new StationReadError(event.reason));
      }
      if (timer) clearTimeout(timer);
      if (!finished && session.expectsResponse) timer = setTimeout(() => handle(session.timeout()), timeoutMs);
    };
    const unsubscribe = transport.onBytes(chunk => {
      options.traffic.push({ at: Date.now(), direction: "in", hex: hex(chunk) });
      handle(session.receive(chunk));
    });
    handle(session.start());
  });
}
