/**
 * SPORTident Reader BT över Web Bluetooth (Chrome/Edge på dator och Android). Stationen läser brickan själv och skickar
 * innehållet; vi startar avläsningsläget, sätter ihop meddelandet, kvitterar och lämnar `SiCardData` till samma
 * `onCardRead` som stationen över USB. Protokollet: `@o-tid/sportident` (`reader-bt.ts`).
 */
import {
  cardTypeFromSi8PlusNumber, CardDecodeError, decodeReaderBtCard, READER_BT_ACK_CARD, READER_BT_CARD_DATA, READER_BT_COMMAND,
  READER_BT_EVENTS, READER_BT_NAME_PREFIX, READER_BT_SERVICE_CARDS, READER_BT_SERVICE_MAIN, READER_BT_START_READOUT, ReaderBtAssembler,
  readerBtCardEvent, readerBtCardNumber, readerBtSerial, readerBtStorageFrames
} from "@o-tid/sportident";
import type { StationCallbacks, StationFacts, StationLink } from "./station";

/** Det vi använder av Web Bluetooth (egna typer, som för Web Serial: DOM-typerna är experimentella). */
export interface BluetoothCharacteristicLike extends EventTarget {
  readonly value?: DataView | null;
  startNotifications(): Promise<unknown>;
  stopNotifications?(): Promise<unknown>;
  writeValueWithResponse(data: Uint8Array<ArrayBuffer>): Promise<void>;
}
interface BluetoothServiceLike { getCharacteristic(uuid: string): Promise<BluetoothCharacteristicLike> }
interface BluetoothServerLike {
  readonly connected: boolean;
  connect(): Promise<BluetoothServerLike>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BluetoothServiceLike>;
}
export interface BluetoothDeviceLike extends EventTarget {
  readonly name?: string | undefined;
  readonly gatt?: BluetoothServerLike | undefined;
}
export interface BluetoothLike {
  requestDevice(options: {
    filters: readonly { readonly namePrefix?: string; readonly services?: readonly string[] }[]; optionalServices: readonly string[];
  }): Promise<BluetoothDeviceLike>;
}

/** Väljaren i webbläsaren visar bara Reader BT; tjänsterna måste anges för att få användas. */
export const READER_BT_REQUEST = {
  filters: [{ namePrefix: READER_BT_NAME_PREFIX }], optionalServices: [READER_BT_SERVICE_MAIN, READER_BT_SERVICE_CARDS]
} as const;

/** Väntetider mellan försöken att ansluta igen när förbindelsen bryts (stationen utom räckhåll en stund, sov). */
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 15000];

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export class ReaderBtController implements StationLink {
  /** Reader BT läser alltid hela brickan själv; valet för snabb utläsning gäller inte här. */
  fastRead = true;
  readonly #device: BluetoothDeviceLike;
  readonly #callbacks: StationCallbacks;
  readonly #lostMessage: string;
  readonly #delays: readonly number[];
  readonly #facts: StationFacts;
  #assembler = new ReaderBtAssembler();
  #events: BluetoothCharacteristicLike | undefined;
  #data: BluetoothCharacteristicLike | undefined;
  #writes: Promise<void> = Promise.resolve();
  #stopped = false;
  #reconnecting = false;
  #insertedAt: number | undefined;

  /** `lostMessage`: beskedet när förbindelsen inte gick att återställa. */
  constructor(device: BluetoothDeviceLike, callbacks: StationCallbacks,
    options: { lostMessage: string; reconnectDelaysMs?: readonly number[] }) {
    this.#device = device;
    this.#callbacks = callbacks;
    this.#lostMessage = options.lostMessage;
    this.#delays = options.reconnectDelaysMs ?? RECONNECT_DELAYS_MS;
    this.#facts = { serialNumber: readerBtSerial(device.name), clock: undefined };
  }

  /** Ansluter och startar avläsningsläget. Sant när stationen tog emot det. */
  async start(): Promise<boolean> {
    this.#callbacks.onStatus({ kind: "connecting" });
    this.#device.addEventListener("gattserverdisconnected", this.#onDisconnected);
    try {
      await this.#connect();
    } catch (error) {
      this.#callbacks.onLog?.(`Reader BT: anslutningen misslyckades (${message(error)})`);
      this.#device.removeEventListener("gattserverdisconnected", this.#onDisconnected);
      this.#stopped = true;
      this.#device.gatt?.disconnect();
      return false;
    }
    this.#ready();
    return true;
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#device.removeEventListener("gattserverdisconnected", this.#onDisconnected);
    this.#detach();
    this.#device.gatt?.disconnect();
    this.#callbacks.onStatus({ kind: "disconnected" });
  }

  #ready(): void {
    this.#callbacks.onLog?.(`Reader BT ${this.#facts.serialNumber ?? "?"}: avläsningsläget på`);
    this.#callbacks.onStatus({ kind: "ready", serialNumber: this.#facts.serialNumber ?? 0, link: "bluetooth" });
  }

  async #connect(): Promise<void> {
    const gatt = this.#device.gatt;
    if (!gatt) throw new Error("Enheten saknar GATT");
    const server = await gatt.connect();
    const cards = await server.getPrimaryService(READER_BT_SERVICE_CARDS);
    const events = await cards.getCharacteristic(READER_BT_EVENTS);
    const data = await cards.getCharacteristic(READER_BT_CARD_DATA);
    const command = await (await server.getPrimaryService(READER_BT_SERVICE_MAIN)).getCharacteristic(READER_BT_COMMAND);
    this.#detach();
    this.#assembler = new ReaderBtAssembler();
    this.#writes = Promise.resolve();
    this.#events = events; this.#data = data;
    events.addEventListener("characteristicvaluechanged", this.#onEvent);
    data.addEventListener("characteristicvaluechanged", this.#onData);
    await events.startNotifications();
    await data.startNotifications();
    await this.#write(command, READER_BT_START_READOUT);
  }

  #detach(): void {
    this.#events?.removeEventListener("characteristicvaluechanged", this.#onEvent);
    this.#data?.removeEventListener("characteristicvaluechanged", this.#onData);
    this.#events = undefined; this.#data = undefined;
  }

  /** Web Bluetooth tillåter en GATT-åtgärd i taget: skrivningarna köas. */
  #write(characteristic: BluetoothCharacteristicLike, bytes: Uint8Array): Promise<void> {
    const copy = new Uint8Array(bytes);
    this.#callbacks.onTraffic?.("out", copy);
    const next = this.#writes.then(() => characteristic.writeValueWithResponse(copy));
    this.#writes = next.catch(() => undefined);
    return next;
  }

  readonly #onDisconnected = (): void => {
    if (this.#stopped || this.#reconnecting) return;
    this.#detach();
    this.#callbacks.onLog?.("Reader BT: förbindelsen bröts; ansluter igen");
    this.#callbacks.onStatus({ kind: "connecting" });
    void this.#reconnect();
  };

  async #reconnect(): Promise<void> {
    this.#reconnecting = true;
    try {
      for (const delay of this.#delays) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (this.#stopped) return;
        try { await this.#connect(); this.#ready(); return; }
        catch (error) { this.#callbacks.onLog?.(`Reader BT: nytt försök misslyckades (${message(error)})`); }
      }
      if (!this.#stopped) this.#callbacks.onStatus({ kind: "error", message: this.#lostMessage });
    } finally {
      this.#reconnecting = false;
    }
  }

  static #bytes(event: Event): Uint8Array | undefined {
    const value = (event.target as BluetoothCharacteristicLike | null)?.value;
    return value ? new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)) : undefined;
  }

  readonly #onEvent = (event: Event): void => {
    const bytes = ReaderBtController.#bytes(event);
    if (!bytes) return;
    this.#callbacks.onTraffic?.("in", bytes);
    const card = readerBtCardEvent(bytes);
    if (card?.inserted) { this.#insertedAt = Date.now(); this.#callbacks.onCardInserted(card.cardNumber); }
  };

  readonly #onData = (event: Event): void => {
    const bytes = ReaderBtController.#bytes(event);
    if (!bytes) return;
    this.#callbacks.onTraffic?.("in", bytes);
    let complete: Uint8Array | undefined;
    try { complete = this.#assembler.push(bytes); }
    catch (error) { this.#callbacks.onLog?.(`Reader BT: ${message(error)} (${hex(bytes.slice(0, 12))} …)`); return; }
    if (!complete) return;
    // Stationen väntar på kvittensen före nästa bricka; den skickas oavsett om innehållet går att tolka.
    if (this.#data) {
      void this.#write(this.#data, READER_BT_ACK_CARD).catch((error: unknown) =>
        this.#callbacks.onLog?.(`Reader BT: kvittensen gick inte fram (${message(error)})`));
    }
    this.#deliver(complete, readerBtStorageFrames(this.#assembler.frames));
  };

  #deliver(complete: Uint8Array, frames: readonly Uint8Array[]): void {
    const cardNumber = readerBtCardNumber(complete) ?? 0;
    if (this.#insertedAt === undefined) this.#callbacks.onCardInserted(cardNumber);
    const ms = this.#insertedAt === undefined ? undefined : Date.now() - this.#insertedAt;
    this.#insertedAt = undefined;
    if (!cardTypeFromSi8PlusNumber(cardNumber)) {
      this.#callbacks.onLog?.(`Reader BT: bricktypen stöds inte (${cardNumber})`);
      this.#callbacks.onUnsupportedCard(cardNumber);
      return;
    }
    try {
      const card = decodeReaderBtCard(complete);
      this.#callbacks.onLog?.(`${card.cardType} ${card.cardNumber}: Reader BT, ${frames.length} ramar${ms === undefined ? "" : `, ${ms} ms`}`);
      this.#callbacks.onCardRead(card, frames, this.#facts);
    } catch (error) {
      if (!(error instanceof CardDecodeError)) throw error;
      this.#callbacks.onLog?.(`${cardNumber}: Reader BT, avläsningen misslyckades (${error.message})`);
      this.#callbacks.onReadFailed(cardNumber, error.message);
    }
  }
}
