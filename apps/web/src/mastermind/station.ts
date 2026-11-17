/**
 * Stationen för spelet: samma `StationController` som avläsningen, över Web Serial (dator), WebUSB (Android) eller
 * övningsstationen, eller Reader BT över Bluetooth (`ReaderBtController`). Spelet behöver bara den utlästa brickan; inga avläsningar sparas eller skickas.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CP210X_USB_FILTERS, WebSerialTransport, WebUsbCp210xPort, type WebSerialPortLike } from "@o-tid/device-transport";
import type { SiCardData } from "@o-tid/sportident";
import { FakeStationTransport } from "../readout/fake-transport";
import { READER_BT_REQUEST, ReaderBtController, type BluetoothLike } from "../readout/reader-bt";
import { StationController, type StationFacts, type StationLink, type StationStatus } from "../readout/station";
import type { SerialApi, UsbApi, UsbStation } from "../readout/station-auto";

type SerialNavigator = Navigator & { serial?: SerialApi };
type UsbNavigator = Navigator & { usb?: UsbApi };
type BluetoothNavigator = Navigator & { bluetooth?: BluetoothLike };
const BAUD_RATES = [38_400, 4_800];

export const hasSerial = typeof navigator !== "undefined" && !!(navigator as SerialNavigator).serial;
export const hasUsb = typeof navigator !== "undefined" && !!(navigator as UsbNavigator).usb;
export const hasBluetooth = typeof navigator !== "undefined" && !!(navigator as BluetoothNavigator).bluetooth;

export type CardEvent =
  | { readonly kind: "inserted"; readonly cardNumber: number }
  /** `clockOffsetMs`: avläsningsstationens klocka minus datorns, när stationen har svarat med sin klocka. */
  | { readonly kind: "read"; readonly card: SiCardData; readonly clockOffsetMs: number | undefined }
  | { readonly kind: "failed"; readonly cardNumber: number }
  | { readonly kind: "unsupported"; readonly cardNumber: number };

export function useGameStation(onCard: (event: CardEvent) => void, messages: {
  serialFailed: string; serialUnsupported: string; usbUnsupported: string; bluetoothFailed: string; bluetoothLost: string
}) {
  const [status, setStatus] = useState<StationStatus>({ kind: "disconnected" });
  const [practice, setPractice] = useState<FakeStationTransport | undefined>(undefined);
  const controllerRef = useRef<StationLink | undefined>(undefined);
  const onCardRef = useRef(onCard);
  useEffect(() => { onCardRef.current = onCard; }, [onCard]);

  const callbacks = {
    onStatus: setStatus,
    onCardInserted: (cardNumber: number) => onCardRef.current({ kind: "inserted", cardNumber }),
    onCardRead: (card: SiCardData, _frames: readonly Uint8Array[], station: StationFacts) =>
      onCardRef.current({ kind: "read", card, clockOffsetMs: station.clock?.clockOffsetMs }),
    onReadFailed: (cardNumber: number) => onCardRef.current({ kind: "failed", cardNumber }),
    onUnsupportedCard: (cardNumber: number) => onCardRef.current({ kind: "unsupported", cardNumber })
  };

  const attach = useCallback(async (controller: StationLink): Promise<boolean> => {
    await controllerRef.current?.stop();
    controllerRef.current = controller;
    return controller.start();
  }, []);

  async function connectPort(port: WebSerialPortLike): Promise<boolean> {
    setPractice(undefined);
    for (const baudRate of BAUD_RATES) {
      if (await attach(new StationController(new WebSerialTransport(port, { baudRate }), callbacks))) return true;
    }
    await controllerRef.current?.stop();
    setStatus({ kind: "error", message: messages.serialFailed });
    return false;
  }

  async function connectSerial() {
    const serial = (navigator as SerialNavigator).serial;
    if (!serial) { setStatus({ kind: "error", message: messages.serialUnsupported }); return; }
    try { await connectPort(await serial.requestPort()); }
    catch { setStatus({ kind: "disconnected" }); }
  }

  async function connectUsb() {
    const usb = (navigator as UsbNavigator).usb;
    if (!usb) { setStatus({ kind: "error", message: messages.usbUnsupported }); return; }
    let device: UsbStation;
    try { device = await usb.requestDevice({ filters: CP210X_USB_FILTERS }); }
    catch { setStatus({ kind: "disconnected" }); return; }
    await connectPort(new WebUsbCp210xPort(device, usb));
  }

  /** Reader BT: webbläsaren frågar efter stationen varje gång (ingen automatisk anslutning). */
  async function connectBluetooth() {
    const bluetooth = (navigator as BluetoothNavigator).bluetooth;
    if (!bluetooth) { setStatus({ kind: "error", message: messages.serialUnsupported }); return; }
    let device;
    try { device = await bluetooth.requestDevice(READER_BT_REQUEST); }
    catch { setStatus({ kind: "disconnected" }); return; }
    setPractice(undefined);
    if (!(await attach(new ReaderBtController(device, callbacks, { lostMessage: messages.bluetoothLost })))) {
      controllerRef.current = undefined;
      setStatus({ kind: "error", message: messages.bluetoothFailed });
    }
  }

  async function connectPractice() {
    const transport = new FakeStationTransport();
    setPractice(transport);
    await attach(new StationController(transport, callbacks));
  }

  async function disconnect() {
    await controllerRef.current?.stop();
    controllerRef.current = undefined;
    setPractice(undefined);
  }

  useEffect(() => () => { void controllerRef.current?.stop(); }, []);

  return { status, practice, connectSerial, connectUsb, connectBluetooth, connectPractice, disconnect };
}
