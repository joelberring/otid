import { ACK, ETX, NAK, STX, WAKEUP } from "./constants";
import { crc16 } from "./crc";

/** En korrekt mottagen ram i utökat protokoll. */
export interface SiFrame {
  readonly command: number;
  /** Stationens kod (de två första databyten i svar från stationen). */
  readonly stationCode: number;
  /** Data efter stationskoden. */
  readonly data: Uint8Array;
  /** Hela ramen som den kom på tråden, från STX till ETX. */
  readonly raw: Uint8Array;
}

export type FrameEvent =
  | { readonly kind: "frame"; readonly frame: SiFrame }
  | { readonly kind: "nak" }
  | { readonly kind: "ack" }
  | {
      readonly kind: "error";
      readonly reason: "crc" | "missing-etx" | "too-short" | "truncated";
      readonly raw: Uint8Array;
    };

/** Bygger en kommandoram: [WAKEUP] STX cmd len params crc(2) ETX. */
export function encodeCommand(command: number, params: Uint8Array | readonly number[] = [], options: { wakeup?: boolean } = {}): Uint8Array {
  const body = Uint8Array.from([command, params.length, ...params]);
  const crc = crc16(body);
  const frame = [STX, ...body, (crc >> 8) & 0xff, crc & 0xff, ETX];
  return Uint8Array.from(options.wakeup === false ? frame : [WAKEUP, ...frame]);
}

/** Bygger en svarsram så som en station skickar den (för tester och falsk station). */
export function encodeStationFrame(command: number, stationCode: number, data: Uint8Array | readonly number[]): Uint8Array {
  const payload = [(stationCode >> 8) & 0xff, stationCode & 0xff, ...data];
  if (payload.length > 255) throw new RangeError("För lång ram");
  const body = Uint8Array.from([command, payload.length, ...payload]);
  const crc = crc16(body);
  return Uint8Array.from([STX, ...body, (crc >> 8) & 0xff, crc & 0xff, ETX]);
}

/**
 * Tolkar en ström av bytes till ramar. Klarar godtyckliga chunkgränser,
 * skräpbytes mellan ramar, fel kontrollsumma och avbrutna ramar.
 *
 * Avkodaren gör ingen I/O. Värden kör `push` för varje mottagen chunk och
 * `flush` när en tidsgräns löper ut och en halv ram ska kastas.
 */
export class FrameDecoder {
  #buffer: number[] = [];
  readonly #stationFrames: boolean;

  /**
   * @param options.stationFrames true (standard) för ramar från en station,
   *   där de två första databyten är stationskoden. false för kommandoramar
   *   från en värd (används av den falska stationen).
   */
  constructor(options: { stationFrames?: boolean } = {}) {
    this.#stationFrames = options.stationFrames ?? true;
  }

  push(chunk: Uint8Array): FrameEvent[] {
    for (const byte of chunk) this.#buffer.push(byte);
    return this.#drain();
  }

  /** Kastar en ofullständig ram och rapporterar den som trunkerad. */
  flush(): FrameEvent[] {
    const pending = this.#buffer;
    this.#buffer = [];
    const start = pending.indexOf(STX);
    if (start < 0) return [];
    return [{ kind: "error", reason: "truncated", raw: Uint8Array.from(pending.slice(start)) }];
  }

  get pendingBytes(): number {
    return this.#buffer.length;
  }

  #drain(): FrameEvent[] {
    const events: FrameEvent[] = [];
    for (;;) {
      // Hoppa över skräp och väckbytes fram till nästa STX, men rapportera NAK/ACK.
      while (this.#buffer.length > 0 && this.#buffer[0] !== STX) {
        const byte = this.#buffer.shift();
        if (byte === NAK) events.push({ kind: "nak" });
        else if (byte === ACK) events.push({ kind: "ack" });
      }
      if (this.#buffer.length < 3) return events;
      const length = this.#buffer[2]!;
      const total = length + 6; // STX cmd len [data] crc crc ETX
      if (this.#buffer.length < total) return events;
      const raw = Uint8Array.from(this.#buffer.slice(0, total));
      if (raw[total - 1] !== ETX) {
        events.push({ kind: "error", reason: "missing-etx", raw });
        this.#buffer.shift(); // börja om efter detta STX
        continue;
      }
      const body = raw.subarray(1, total - 3);
      const crc = (raw[total - 3]! << 8) | raw[total - 2]!;
      if (crc16(body) !== crc) {
        events.push({ kind: "error", reason: "crc", raw });
        this.#buffer.shift();
        continue;
      }
      this.#buffer.splice(0, total);
      if (!this.#stationFrames) {
        events.push({ kind: "frame", frame: { command: raw[1]!, stationCode: 0, data: raw.slice(3, total - 3), raw } });
        continue;
      }
      if (length < 2) {
        events.push({ kind: "error", reason: "too-short", raw });
        continue;
      }
      events.push({
        kind: "frame",
        frame: {
          command: raw[1]!,
          stationCode: (raw[3]! << 8) | raw[4]!,
          data: raw.slice(5, total - 3),
          raw
        }
      });
    }
  }
}
