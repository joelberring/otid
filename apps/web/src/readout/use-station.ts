/**
 * Stationen: anslutning över Web Serial, WebUSB (läsplatta) eller övningsstationen, automatisk anslutning till den sparade
 * stationen (steg 35), snabb utläsning (steg 53) och trafikloggen. Avläsningarna lämnas till `onCardRead`.
 */
import { useCallback, useRef, useState, type MutableRefObject } from "react";
import type { ReadoutPackage } from "@o-tid/contracts";
import { CP210X_USB_FILTERS, WebSerialTransport, WebUsbCp210xPort, type WebSerialPortLike } from "@o-tid/device-transport";
import { SiTimeError, type SiCardData } from "@o-tid/sportident";
import { FakeStationTransport } from "./fake-transport";
import { loadFastRead, saveFastRead, StationController, type StationFacts, type StationStatus } from "./station";
import { TrafficLog } from "./rawlog";
import { serialIdentity, usbIdentity, useStationAutoConnect, type SerialApi, type SerialStation, type UsbApi,
  type UsbStation } from "./station-auto";
import type { ReadoutSound } from "./sound";
import { readoutText as t } from "./text-sv";
import type { Current } from "./verdict-panel";

type SerialNavigator = Navigator & { serial?: SerialApi };
/** WebUSB: läsplattor (Chrome på Android ser inte stationens CP210x-chip som serieport). */
type UsbNavigator = Navigator & { usb?: UsbApi };
/** Visa USB-knappen där Web Serial inte når stationen: Android, eller utan Web Serial. */
export const showUsbButton = typeof navigator !== "undefined" && !!(navigator as UsbNavigator).usb &&
  (/Android/i.test(navigator.userAgent) || !(navigator as SerialNavigator).serial);
const BAUD_RATES = [38_400, 4_800];

export function useStation({ pkgRef, ready, sound, onCardRead, setCurrent }: {
  pkgRef: MutableRefObject<ReadoutPackage | undefined>; ready: boolean; sound: MutableRefObject<ReadoutSound>;
  /** `exercise` = övningsstationen när den är ansluten (dess klocka står på tävlingsdagen). */
  onCardRead: (card: SiCardData, frames: readonly Uint8Array[], station: StationFacts, exercise: FakeStationTransport | undefined) => Promise<void>;
  setCurrent: (current: Current) => void;
}) {
  const [station, setStation] = useState<StationStatus>({ kind: "disconnected" });
  const [exercise, setExercise] = useState(false);
  const controllerRef = useRef<StationController | undefined>(undefined);
  const exerciseRef = useRef<FakeStationTransport | undefined>(undefined);
  const trafficRef = useRef(new TrafficLog());
  // Steg 53: snabb utläsning av SI10/11/SIAC (och SI6), på som förval; kan stängas av om en station krånglar.
  const [fastRead, setFastRead] = useState(() => loadFastRead());
  const fastReadRef = useRef(fastRead);

  const attach = useCallback(async (controller: StationController): Promise<boolean> => {
    await controllerRef.current?.stop();
    controllerRef.current = controller;
    return controller.start();
  }, []);

  const callbacks = {
    onStatus: setStation,
    onCardInserted: (cardNumber: number) => setCurrent({ phase: "reading", cardNumber }),
    onCardRead: (card: SiCardData, frames: readonly Uint8Array[], station: StationFacts) => {
      onCardRead(card, frames, station, exerciseRef.current).catch((error: unknown) =>
        setCurrent({ phase: "failed", at: Date.now(), message: error instanceof SiTimeError ? t.timeUnresolvable(error.message)
          : error instanceof Error ? error.message : String(error) }));
    },
    onReadFailed: (cardNumber: number) => setCurrent({ phase: "failed", at: Date.now(), message: t.readFailed(cardNumber) }),
    onUnsupportedCard: (cardNumber: number) => setCurrent({ phase: "failed", at: Date.now(), message: t.unsupported(cardNumber) }),
    onTraffic: (direction: "in" | "out", bytes: Uint8Array) => trafficRef.current.add(direction, bytes),
    onLog: (text: string) => trafficRef.current.note(text)
  };

  function changeFastRead(enabled: boolean) {
    setFastRead(enabled); saveFastRead(enabled); fastReadRef.current = enabled;
    if (controllerRef.current) controllerRef.current.fastRead = enabled;
    trafficRef.current.note(`Snabb utläsning ${enabled ? "på" : "av"}`);
  }

  async function connectSerial() {
    void sound.current.unlock();
    const serial = (navigator as SerialNavigator).serial;
    if (!serial) { setStation({ kind: "error", message: t.serialUnsupported }); return; }
    let port: SerialStation;
    try { port = await serial.requestPort(); }
    catch { setStation({ kind: "disconnected" }); return; }
    // Steg 35: en lyckad anslutning sparas, så att stationen ansluts själv nästa gång.
    if (await connectPort(port)) auto.remember("serial", serialIdentity(port));
  }

  /** Ger sant när stationen svarade (på någon av hastigheterna). */
  async function connectPort(port: WebSerialPortLike): Promise<boolean> {
    exerciseRef.current = undefined; setExercise(false);
    const timeZone = pkgRef.current?.event.timeZone;
    for (const baudRate of BAUD_RATES) {
      trafficRef.current.note(`Ansluter med ${baudRate} baud`);
      if (await attach(new StationController(new WebSerialTransport(port, { baudRate }), callbacks,
        { fastRead: fastReadRef.current, ...(timeZone ? { timeZone } : {}) }))) return true;
    }
    await controllerRef.current?.stop();
    setStation({ kind: "error", message: t.serialFailed });
    return false;
  }

  /** Stationen direkt över WebUSB (läsplatta). Samma avläsning som Web Serial när porten väl är öppen. */
  async function connectUsb() {
    void sound.current.unlock();
    const usb = (navigator as UsbNavigator).usb;
    if (!usb) { setStation({ kind: "error", message: t.usbUnsupported }); return; }
    let device: UsbStation;
    try { device = await usb.requestDevice({ filters: CP210X_USB_FILTERS }); }
    catch { setStation({ kind: "disconnected" }); return; }
    if (await connectUsbDevice(device)) auto.remember("usb", usbIdentity(device));
  }

  /** En godkänd USB-enhet (vald nu eller sparad sedan förut). */
  async function connectUsbDevice(device: UsbStation): Promise<boolean> {
    const usb = (navigator as UsbNavigator).usb;
    if (!usb) return false;
    const port = new WebUsbCp210xPort(device, usb);
    // Prova att ta enheten först: en annan app på plattan kan hålla den.
    try { await port.open({ baudRate: BAUD_RATES[0]! }); await port.close(); }
    catch (error) {
      setStation({ kind: "error", message: t.usbBusy(error instanceof Error ? error.message : String(error)) });
      return false;
    }
    return connectPort(port);
  }

  async function connectExercise() {
    void sound.current.unlock();
    const timeZone = pkgRef.current?.event.timeZone;
    const transport = new FakeStationTransport(timeZone ? { timeZone } : {});
    exerciseRef.current = transport; setExercise(true);
    await attach(new StationController(transport, callbacks, { fastRead: fastReadRef.current, ...(timeZone ? { timeZone } : {}) }));
  }

  async function disconnect() {
    // Steg 35: en manuell frånkoppling ansluter inte igen av sig själv förrän nästa gång sidan öppnas.
    auto.pause();
    await controllerRef.current?.stop();
    controllerRef.current = undefined; exerciseRef.current = undefined; setExercise(false);
  }

  // Steg 35: stationen ansluts själv när sidan öppnas och när den sätts i, om den har anslutits här förut.
  const connected = station.kind === "ready" || station.kind === "misconfigured" || station.kind === "connecting";
  const auto = useStationAutoConnect({ serial: (navigator as SerialNavigator).serial, usb: (navigator as UsbNavigator).usb,
    connected, ready, connectSerialPort: connectPort, connectUsbDevice,
    label: (link, index, identity, name) => link === "usb" ? t.autoStationUsb(index, identity.serialNumber, name) : t.autoStationSerial(index) });

  return { station, exercise, exerciseRef, trafficRef, fastRead, changeFastRead, connected, auto, connectSerial, connectUsb, connectExercise,
    disconnect };
}
