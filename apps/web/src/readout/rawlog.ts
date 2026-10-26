import { toHex } from "./payload";
import type { QueuedReadout } from "./store";

/**
 * Rålogg för steg 7 (riktig hårdvara): all trafik mot stationen sedan sidan
 * öppnades plus råramarna för loppets sparade avläsningar. Innehåller
 * bricknummer och tider men inga namn.
 */
export interface TrafficEntry { readonly at: string; readonly direction: "in" | "out"; readonly hex: string }
/** Steg 53: händelser i klartext, t.ex. att den snabba utläsningen gav upp och brickan lästes med "alla block". */
export interface NoteEntry { readonly at: string; readonly text: string }

const MAX_ENTRIES = 20_000;
const MAX_NOTES = 2_000;

export class TrafficLog {
  readonly #entries: TrafficEntry[] = [];
  readonly #notes: NoteEntry[] = [];
  #dropped = 0;

  note(text: string, at = new Date()): void {
    this.#notes.push({ at: at.toISOString(), text });
    if (this.#notes.length > MAX_NOTES) this.#notes.shift();
  }

  get notes(): readonly NoteEntry[] { return this.#notes; }

  add(direction: "in" | "out", bytes: Uint8Array, at = new Date()): void {
    this.#entries.push({ at: at.toISOString(), direction, hex: toHex(bytes) });
    if (this.#entries.length > MAX_ENTRIES) { this.#entries.shift(); this.#dropped += 1; }
  }

  get size(): number { return this.#entries.length; }

  /** JSON-dokument att ladda ner och skicka till utvecklaren. */
  export(raceId: string, readouts: readonly QueuedReadout[], userAgent: string, now = new Date()): string {
    return JSON.stringify({
      format: "otid-readout-rawlog", formatVersion: 1, raceId, exportedAt: now.toISOString(), userAgent,
      droppedTrafficEntries: this.#dropped, notes: this.#notes, traffic: this.#entries,
      readouts: readouts.map((item) => ({
        localSequence: item.localSequence, stationReceivedAt: item.stationReceivedAt, status: item.status,
        cardNumber: item.payload.cardNumber, cardType: item.payload.cardType, simulated: item.payload.simulated,
        ...(item.payload.stationSerial !== undefined ? { stationSerial: item.payload.stationSerial } : {}),
        frames: item.payload.frames
      }))
    }, null, 2);
  }
}
