/**
 * Stationen för spelet: samma `StationController` som avläsningen, över Web Serial (dator), WebUSB (Android) eller
 * övningsstationen. Spelet behöver bara den utlästa brickan; inga avläsningar sparas eller skickas.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CP210X_USB_FILTERS, WebSerialTransport, WebUsbCp210xPort, type WebSerialPortLike } from "@o-tid/device-transport";
import type { SiCardData } from "@o-tid/sportident";
import { FakeStationTransport } from "../readout/fake-transport";
import { StationController, type StationFacts, type StationStatus } from "../readout/station";
import type { SerialApi, UsbApi, UsbStation } from "../readout/station-auto";

type SerialNavigator = Navigator & { serial?: SerialApi };
type UsbNavigator = Navigator & { usb?: UsbApi };
const BAUD_RATES = [38_400, 4_800];

export const hasSerial = typeof navigator !== "undefined" && !!(navigator as SerialNavigator).serial;
export const hasUsb = typeof navigator !== "undefined" && !!(navigator as UsbNavigator).usb;

export type CardEvent =
  | { readonly kind: "inserted"; readonly cardNumber: number }
  /** `clockOffsetMs`: avläsningsstationens klocka minus datorns, när stationen har svarat med sin klocka. */
  | { readonly kind: "read"; readonly card: SiCardData; readonly clockOffsetMs: number | undefined }
  | { readonly kind: "failed"; readonly cardNumber: number }
  | { readonly kind: "unsupported"; readonly cardNumber: number };

export function useGameStation(onCard: (event: CardEvent) => void, messages: { serialFailed: string; serialUnsupported: string; usbUnsupported: string }) {
  const [status, setStatus] = useState<StationStatus>({ kind: "disconnected" });
  const [practice, setPractice] = useState<FakeStationTransport | undefined>(undefined);
  const controllerRef = useRef<StationController | undefined>(undefined);
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

  const attach = useCallback(async (controller: StationController): Promise<boolean> => {
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

  return { status, practice, connectSerial, connectUsb, connectPractice, disconnect };
}
