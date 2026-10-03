import { BLOCK_SIZE, Command, MASTER_DIRECT, READ_ALL_BLOCKS, StationMode, SystemOffset } from "./constants";
import { CARD_LAYOUTS, expectedImageSize, type FieldLayout, type SiCardType } from "./card-types";
import { encodeStationFrame, FrameDecoder } from "./frame";

/** Lokal väggklocka för en stämpling på den falska brickan. */
export interface SimulatedTime {
  /** Sekunder sedan midnatt, 0–86 399. */
  readonly secondsOfDay: number;
  /** 0 = söndag … 6 = lördag. */
  readonly dayOfWeek: number;
}

export interface SimulatedCard {
  readonly cardType: SiCardType;
  readonly cardNumber: number;
  readonly start?: SimulatedTime;
  readonly finish?: SimulatedTime;
  readonly check?: SimulatedTime;
  readonly clear?: SimulatedTime;
  readonly punches: readonly { readonly code: number; readonly time: SimulatedTime }[];
}

/**
 * Bygger en brickas minnesbild (i läsordning) från en beskrivning.
 * Tom brickminne är 0xEE, precis som på riktiga brickor.
 */
export function encodeCardImage(card: SimulatedCard): Uint8Array {
  const layout = CARD_LAYOUTS[card.cardType];
  const image = new Uint8Array(expectedImageSize(card.cardType)).fill(0xee);
  const [high, mid, low] = layout.cardNumber;

  if (card.cardType === "SI5") {
    const series = card.cardNumber >= 100_000 ? Math.floor(card.cardNumber / 100_000) : 1;
    const number = card.cardNumber >= 100_000 ? card.cardNumber % 100_000 : card.cardNumber;
    image[high] = series;
    image[mid] = (number >> 8) & 0xff;
    image[low] = number & 0xff;
  } else {
    image[high] = (card.cardNumber >> 16) & 0xff;
    image[mid] = (card.cardNumber >> 8) & 0xff;
    image[low] = card.cardNumber & 0xff;
    if (card.cardType !== "SI6") image[24] = 0x0f;
  }

  const writeField = (field: FieldLayout | undefined, time: SimulatedTime | undefined, code = 0): void => {
    if (!field || !time) return;
    const pm = time.secondsOfDay >= 43_200;
    const seconds = time.secondsOfDay % 43_200;
    image[field.time] = (seconds >> 8) & 0xff;
    image[field.time + 1] = seconds & 0xff;
    if (field.dayByte !== undefined) image[field.dayByte] = (time.dayOfWeek << 1) | (pm ? 1 : 0);
    if (field.code !== undefined) image[field.code] = code;
  };
  writeField(layout.start, card.start, 1);
  writeField(layout.finish, card.finish, 2);
  writeField(layout.check, card.check, 3);
  writeField(layout.clear, card.clear, 4);

  if (card.punches.length > layout.maxPunches) {
    throw new RangeError(`${card.cardType} rymmer högst ${layout.maxPunches} tidsatta stämplingar`);
  }
  if (card.cardType === "SI5") {
    image[layout.punchCount] = card.punches.length + 1;
    let offset = layout.firstPunch;
    for (const punch of card.punches) {
      if (offset % 16 === 0) offset += 1;
      const seconds = punch.time.secondsOfDay % 43_200;
      image[offset] = punch.code & 0xff;
      image[offset + 1] = (seconds >> 8) & 0xff;
      image[offset + 2] = seconds & 0xff;
      offset += 3;
    }
  } else {
    image[layout.punchCount] = card.punches.length;
    card.punches.forEach((punch, index) => {
      const offset = layout.firstPunch + index * 4;
      const pm = punch.time.secondsOfDay >= 43_200;
      const seconds = punch.time.secondsOfDay % 43_200;
      image[offset] = ((punch.code >> 8) << 6) | (punch.time.dayOfWeek << 1) | (pm ? 1 : 0);
      image[offset + 1] = punch.code & 0xff;
      image[offset + 2] = (seconds >> 8) & 0xff;
      image[offset + 3] = seconds & 0xff;
    });
  }
  return image;
}

export interface FakeStationOptions {
  readonly stationCode?: number;
  readonly serialNumber?: number;
  readonly mode?: number;
  readonly extendedProtocol?: boolean;
  readonly handshake?: boolean;
}

/**
 * En falsk avläsningsstation som pratar samma protokoll som en riktig.
 * Används i tester och i webbens utvecklingsläge "falsk station".
 */
export class FakeSiStation {
  readonly #decoder = new FrameDecoder({ stationFrames: false });
  readonly #options: Required<FakeStationOptions>;
  #card: { readonly spec: SimulatedCard; readonly image: Uint8Array } | undefined;

  constructor(options: FakeStationOptions = {}) {
    this.#options = {
      stationCode: options.stationCode ?? 10,
      serialNumber: options.serialNumber ?? 123_456,
      mode: options.mode ?? StationMode.READOUT,
      extendedProtocol: options.extendedProtocol ?? true,
      handshake: options.handshake ?? true
    };
  }

  /** Stationen tar emot bytes från värden och svarar med noll eller flera ramar. */
  receive(bytes: Uint8Array): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (const event of this.#decoder.push(bytes)) {
      if (event.kind !== "frame") continue;
      out.push(...this.#respond(event.frame.command, event.frame.data));
    }
    return out;
  }

  /** Brickan sätts i: returnerar detekteringsramen (och data om stationen saknar handskakning). */
  insert(card: SimulatedCard): Uint8Array[] {
    this.#card = { spec: card, image: encodeCardImage(card) };
    const n = card.cardNumber;
    const detection =
      card.cardType === "SI5"
        ? this.#frame(Command.SI5_DETECTED, [0x00, n >= 100_000 ? Math.floor(n / 100_000) : 1, ((n % 100_000) >> 8) & 0xff, n % 100_000 & 0xff])
        : this.#frame(card.cardType === "SI6" ? Command.SI6_DETECTED : Command.SI8_PLUS_DETECTED, [
            card.cardType === "SI6" ? 0x00 : 0x0f,
            (n >> 16) & 0xff,
            (n >> 8) & 0xff,
            n & 0xff
          ]);
    if (this.#options.handshake) return [detection];
    return [detection, ...this.#allCardFrames()];
  }

  remove(): Uint8Array {
    this.#card = undefined;
    return this.#frame(Command.CARD_REMOVED, [0x00, 0x00, 0x00, 0x00]);
  }

  #allCardFrames(): Uint8Array[] {
    const card = this.#card;
    if (!card) return [];
    switch (card.spec.cardType) {
      case "SI5":
        return this.#respond(Command.READ_SI5, new Uint8Array());
      case "SI6":
        return this.#respond(Command.READ_SI6, Uint8Array.of(READ_ALL_BLOCKS));
      case "SI8":
      case "SI9":
      case "pCard":
        return [...this.#respond(Command.READ_SI8_PLUS, Uint8Array.of(0)), ...this.#respond(Command.READ_SI8_PLUS, Uint8Array.of(1))];
      default:
        return this.#respond(Command.READ_SI8_PLUS, Uint8Array.of(READ_ALL_BLOCKS));
    }
  }

  #frame(command: number, data: readonly number[] | Uint8Array): Uint8Array {
    return encodeStationFrame(command, this.#options.stationCode, data);
  }

  #block(image: Uint8Array, index: number): Uint8Array {
    return image.subarray(index * BLOCK_SIZE, (index + 1) * BLOCK_SIZE);
  }

  #respond(command: number, params: Uint8Array): Uint8Array[] {
    switch (command) {
      case Command.SET_MASTER_SLAVE:
        return [this.#frame(Command.SET_MASTER_SLAVE, [params[0] ?? MASTER_DIRECT])];
      case Command.GET_SYSTEM_VALUE: {
        const sys = new Uint8Array(0x80);
        const serial = this.#options.serialNumber;
        sys[SystemOffset.SERIAL_NUMBER] = (serial >>> 24) & 0xff;
        sys[SystemOffset.SERIAL_NUMBER + 1] = (serial >> 16) & 0xff;
        sys[SystemOffset.SERIAL_NUMBER + 2] = (serial >> 8) & 0xff;
        sys[SystemOffset.SERIAL_NUMBER + 3] = serial & 0xff;
        sys[SystemOffset.MODE] = this.#options.mode;
        sys[SystemOffset.STATION_CODE] = this.#options.stationCode & 0xff;
        sys[SystemOffset.PROTOCOL] = (this.#options.extendedProtocol ? 0b001 : 0) | (this.#options.handshake ? 0b100 : 0);
        return [this.#frame(Command.GET_SYSTEM_VALUE, [params[0] ?? 0, ...sys])];
      }
    }
    const card = this.#card;
    if (!card) return [];
    const image = card.image;
    switch (command) {
      case Command.READ_SI5:
        return card.spec.cardType === "SI5" ? [this.#frame(Command.READ_SI5, this.#block(image, 0))] : [];
      case Command.READ_SI6:
        if (card.spec.cardType !== "SI6") return [];
        return [0, 6, 7].map((block, index) => this.#frame(Command.READ_SI6, [block, ...this.#block(image, index)]));
      case Command.READ_SI8_PLUS: {
        const param = params[0] ?? 0;
        if (param === READ_ALL_BLOCKS) {
          return [0, 4, 5, 6, 7].map((block, index) => this.#frame(Command.READ_SI8_PLUS, [block, ...this.#block(image, index)]));
        }
        return [this.#frame(Command.READ_SI8_PLUS, [param, ...this.#block(image, param)])];
      }
      default:
        return [];
    }
  }
}
