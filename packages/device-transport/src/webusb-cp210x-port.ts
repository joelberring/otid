import type { WebSerialOpenOptions, WebSerialPortLike } from "./web-serial-transport";

/**
 * SPORTident-stationer (BSM7/8-USB, SRR) har ett USB-chip från Silicon Labs, CP210x. Datorer har en drivrutin som gör
 * chipet till en serieport (Web Serial), men Chrome på Android ser bara standardklassade serieportar. Här pratar vi med
 * chipet direkt över WebUSB med samma styrkommandon som Linux drivrutin `cp210x.c`, och ger samma gränssnitt som en
 * Web Serial-port, så att resten av avläsningen är densamma.
 */

/** Silicon Labs. SPORTident använder 0x800A, generiska CP210x 0xEA60. */
export const CP210X_VENDOR_ID = 0x10c4;
export const CP210X_USB_FILTERS: readonly { vendorId: number }[] = Object.freeze([{ vendorId: CP210X_VENDOR_ID }]);

/** CP210x styrkommandon (AN571). */
export const CP210X = Object.freeze({
  IFC_ENABLE: 0x00,
  SET_LINE_CTL: 0x03,
  SET_MHS: 0x07,
  PURGE: 0x12,
  SET_BAUDRATE: 0x1e,
  UART_ENABLE: 0x0001,
  UART_DISABLE: 0x0000,
  /** DTR och RTS på, med mask för båda. */
  MHS_DTR_RTS_ON: 0x0303,
  /** Töm sändnings- och mottagningsbuffertar. */
  PURGE_ALL: 0x000f
});

/** Det vi använder av WebUSB, strukturellt, så att paketet inte beror på experimentella DOM-typer. */
export interface UsbEndpointLike { readonly endpointNumber: number; readonly direction: "in" | "out"; readonly type: string }
export interface UsbAlternateLike { readonly endpoints: readonly UsbEndpointLike[] }
export interface UsbInterfaceLike { readonly interfaceNumber: number; readonly alternate: UsbAlternateLike }
export interface UsbConfigurationLike { readonly configurationValue: number; readonly interfaces: readonly UsbInterfaceLike[] }
export interface UsbControlSetup {
  readonly requestType: "vendor"; readonly recipient: "interface"; readonly request: number; readonly value: number; readonly index: number;
}
export interface UsbInResult { readonly status?: string; readonly data?: DataView }
export interface UsbOutResult { readonly status?: string; readonly bytesWritten?: number }
export interface UsbDeviceLike {
  readonly vendorId: number;
  readonly productId: number;
  readonly opened: boolean;
  readonly configuration: UsbConfigurationLike | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  controlTransferOut(setup: UsbControlSetup, data?: BufferSource): Promise<UsbOutResult>;
  transferIn(endpointNumber: number, length: number): Promise<UsbInResult>;
  transferOut(endpointNumber: number, data: BufferSource): Promise<UsbOutResult>;
}
export interface UsbLike {
  addEventListener(type: "disconnect", listener: (event: { readonly device: unknown }) => void): void;
  removeEventListener(type: "disconnect", listener: (event: { readonly device: unknown }) => void): void;
}

const PACKET_SIZE = 64;

interface Opened { readonly interfaceNumber: number; readonly inEndpoint: number; readonly outEndpoint: number }

export class WebUsbCp210xPort implements WebSerialPortLike {
  readonly #device: UsbDeviceLike;
  readonly #usb: UsbLike | undefined;
  #opened: Opened | undefined;
  #closing = false;
  #readable: ReadableStream<Uint8Array> | null = null;
  #writable: WritableStream<Uint8Array> | null = null;
  readonly #disconnectListeners = new Set<() => void>();
  readonly #onUsbDisconnect = (event: { readonly device: unknown }): void => {
    if (event.device !== this.#device) return;
    for (const listener of [...this.#disconnectListeners]) listener();
  };

  constructor(device: UsbDeviceLike, usb?: UsbLike) {
    this.#device = device;
    this.#usb = usb;
  }

  get readable(): WebSerialPortLike["readable"] { return this.#readable as WebSerialPortLike["readable"]; }
  get writable(): WebSerialPortLike["writable"] { return this.#writable as WebSerialPortLike["writable"]; }

  async open(options: WebSerialOpenOptions): Promise<void> {
    if (this.#opened) throw new Error("USB-porten är redan öppen");
    const device = this.#device;
    if (!device.opened) await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    const configuration = device.configuration as UsbConfigurationLike | null;
    const found = configuration?.interfaces.map((usbInterface) => ({ usbInterface,
      inEndpoint: usbInterface.alternate.endpoints.find((endpoint) => endpoint.direction === "in" && endpoint.type === "bulk"),
      outEndpoint: usbInterface.alternate.endpoints.find((endpoint) => endpoint.direction === "out" && endpoint.type === "bulk") }))
      .find((candidate) => candidate.inEndpoint && candidate.outEndpoint);
    if (!found?.inEndpoint || !found.outEndpoint) throw new Error("USB-enheten saknar dataändpunkter (är det en SPORTident-station?)");
    const interfaceNumber = found.usbInterface.interfaceNumber;
    await device.claimInterface(interfaceNumber);
    const control = (request: number, value: number, data?: BufferSource) =>
      device.controlTransferOut({ requestType: "vendor", recipient: "interface", request, value, index: interfaceNumber }, data);
    await control(CP210X.IFC_ENABLE, CP210X.UART_ENABLE);
    const baud = new DataView(new ArrayBuffer(4));
    baud.setUint32(0, options.baudRate, true);
    await control(CP210X.SET_BAUDRATE, 0, baud.buffer);
    // 8 databitar, ingen paritet, 1 stoppbit (det SPORTident använder).
    await control(CP210X.SET_LINE_CTL, 0x0800);
    await control(CP210X.SET_MHS, CP210X.MHS_DTR_RTS_ON);
    await control(CP210X.PURGE, CP210X.PURGE_ALL);
    const opened: Opened = { interfaceNumber, inEndpoint: found.inEndpoint.endpointNumber, outEndpoint: found.outEndpoint.endpointNumber };
    this.#opened = opened;
    this.#closing = false;
    this.#readable = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        // En väntande överföring per läsning; tomma svar (inga byte ännu) väntar vidare.
        for (;;) {
          if (this.#closing) { controller.close(); return; }
          let result: UsbInResult;
          try { result = await device.transferIn(opened.inEndpoint, PACKET_SIZE); }
          catch (error) {
            if (this.#closing) { controller.close(); return; }
            throw error;
          }
          if (result.status === "stall") {
            // Rensa en stoppad ändpunkt genom att försöka igen; enheten skickar inget på en stall.
            continue;
          }
          const data = result.data;
          if (data && data.byteLength > 0) {
            controller.enqueue(new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
            return;
          }
        }
      },
      // Transporten avbryter läsaren innan porten stängs; en väntande överföring avbryts när enheten stängs.
      cancel: () => { this.#closing = true; }
    });
    this.#writable = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        const result = await device.transferOut(opened.outEndpoint, chunk.slice());
        if (result.status && result.status !== "ok") throw new Error(`USB-skrivningen misslyckades (${result.status})`);
      }
    });
    this.#usb?.addEventListener("disconnect", this.#onUsbDisconnect);
  }

  async close(): Promise<void> {
    const opened = this.#opened;
    if (!opened) return;
    this.#closing = true;
    this.#opened = undefined;
    this.#usb?.removeEventListener("disconnect", this.#onUsbDisconnect);
    const device = this.#device;
    try {
      await device.controlTransferOut({ requestType: "vendor", recipient: "interface", request: CP210X.IFC_ENABLE,
        value: CP210X.UART_DISABLE, index: opened.interfaceNumber });
    } catch { /* enheten kan redan vara urdragen */ }
    try { await device.releaseInterface(opened.interfaceNumber); } catch { /* som ovan */ }
    // Stänger enheten, vilket också avbryter en väntande läsning.
    try { await device.close(); } catch { /* som ovan */ }
    this.#readable = null;
    this.#writable = null;
  }

  addEventListener(type: "disconnect", listener: () => void): void {
    if (type === "disconnect") this.#disconnectListeners.add(listener);
  }

  removeEventListener(type: "disconnect", listener: () => void): void {
    if (type === "disconnect") this.#disconnectListeners.delete(listener);
  }
}
