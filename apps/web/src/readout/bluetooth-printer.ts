/**
 * Kvittoskrivare över Web Bluetooth (BLE): skrivare med tjänsten 18f0 och skrivegenskapen 2af1, som tar emot ESC/POS
 * (SPORTidents SI Printer 2 och många andra 58 mm-skrivare). Kvittot byggs av `escpos.ts`. Webbläsaren frågar efter
 * skrivaren när den ansluts; förbindelsen återställs själv före nästa utskrift om den har brutits.
 */
import type { BluetoothCharacteristicLike, BluetoothDeviceLike, BluetoothLike } from "./reader-bt";

export const PRINTER_SERVICE = "000018f0-0000-1000-8000-00805f9b34fb";
export const PRINTER_WRITE = "00002af1-0000-1000-8000-00805f9b34fb";

/** Väljaren visar skrivare med tjänsten 18f0 (de flesta annonserar den) och SPORTidents skrivare efter namn. */
export const PRINTER_REQUEST = {
  filters: [{ services: [PRINTER_SERVICE] }, { namePrefix: "SI Printer" }], optionalServices: [PRINTER_SERVICE]
} as const;

/** Bytes per skrivning: ryms i den minsta MTU som telefoner brukar förhandla fram, och skrivarens buffert hinner med. */
const CHUNK = 100;

export class BluetoothPrinter {
  readonly #device: BluetoothDeviceLike;
  #write: BluetoothCharacteristicLike | undefined;
  #queue: Promise<void> = Promise.resolve();

  constructor(device: BluetoothDeviceLike) { this.#device = device; }

  /** Ber webbläsaren om en skrivare och ansluter. */
  static async request(bluetooth: BluetoothLike): Promise<BluetoothPrinter> {
    const printer = new BluetoothPrinter(await bluetooth.requestDevice(PRINTER_REQUEST));
    await printer.connect();
    return printer;
  }

  get name(): string { return this.#device.name ?? "Bluetooth"; }

  async connect(): Promise<void> {
    const gatt = this.#device.gatt;
    if (!gatt) throw new Error("Skrivaren saknar GATT");
    const server = await gatt.connect();
    this.#write = await (await server.getPrimaryService(PRINTER_SERVICE)).getCharacteristic(PRINTER_WRITE);
  }

  /** Skickar bytes i bitar, en utskrift i taget. Ansluter igen först om förbindelsen har brutits. */
  print(bytes: Uint8Array): Promise<void> {
    const job = this.#queue.then(async () => {
      if (!this.#write || !this.#device.gatt?.connected) await this.connect();
      for (let at = 0; at < bytes.length; at += CHUNK) {
        await this.#write!.writeValueWithResponse(bytes.slice(at, at + CHUNK));
      }
    });
    this.#queue = job.catch(() => undefined);
    return job;
  }

  disconnect(): void { this.#device.gatt?.disconnect(); this.#write = undefined; }
}
