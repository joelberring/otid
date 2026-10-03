import { toHex } from "./payload";
import type { QueuedReadout } from "./store";

/**
 * Rålogg för steg 7 (riktig hårdvara): all trafik mot stationen sedan sidan
 * öppnades plus råramarna för loppets sparade avläsningar. Innehåller
 * bricknummer och tider men inga namn.
 */
export interface TrafficEntry { readonly at: string; readonly direction: "in" | "out"; readonly hex: string }

const MAX_ENTRIES = 20_000;

export class TrafficLog {
  readonly #entries: TrafficEntry[] = [];
  #dropped = 0;

  add(direction: "in" | "out", bytes: Uint8Array, at = new Date()): void {
    this.#entries.push({ at: at.toISOString(), direction, hex: toHex(bytes) });
    if (this.#entries.length > MAX_ENTRIES) { this.#entries.shift(); this.#dropped += 1; }
  }

  get size(): number { return this.#entries.length; }

  /** JSON-dokument att ladda ner och skicka till utvecklaren. */
  export(raceId: string, readouts: readonly QueuedReadout[], userAgent: string, now = new Date()): string {
    return JSON.stringify({
      format: "otid-readout-rawlog", formatVersion: 1, raceId, exportedAt: now.toISOString(), userAgent,
      droppedTrafficEntries: this.#dropped, traffic: this.#entries,
      readouts: readouts.map((item) => ({
        localSequence: item.localSequence, stationReceivedAt: item.stationReceivedAt, status: item.status,
        cardNumber: item.payload.cardNumber, cardType: item.payload.cardType, simulated: item.payload.simulated,
        ...(item.payload.stationSerial !== undefined ? { stationSerial: item.payload.stationSerial } : {}),
        frames: item.payload.frames
      }))
    }, null, 2);
  }
}
