import { useCallback, useEffect, useRef, useState } from "react";
import { CP210X_VENDOR_ID, type UsbDeviceLike, type UsbLike, type WebSerialPortLike } from "@o-tid/device-transport";
import { chooseStation, forgetStation, loadRememberedStation, rememberStation, type RememberedStation, type StationIdentity,
  type StationLink } from "./station-memory";

/** WebUSB-enheten med det webbläsaren berättar om den (serienumret saknas på vissa plattor). */
export type UsbStation = UsbDeviceLike & { readonly serialNumber?: string | undefined; readonly productName?: string | undefined };
/** En Web Serial-port; `getInfo()` ger tillverkare och produkt för en USB-port. */
export type SerialStation = WebSerialPortLike & { getInfo?(): { usbVendorId?: number; usbProductId?: number } };
type ConnectEvents = { addEventListener?(type: "connect", listener: () => void): void;
  removeEventListener?(type: "connect", listener: () => void): void };
export type SerialApi = ConnectEvents & { requestPort(): Promise<SerialStation>; getPorts?(): Promise<SerialStation[]> };
export type UsbApi = UsbLike & ConnectEvents & {
  requestDevice(options: { filters: readonly { vendorId: number }[] }): Promise<UsbStation>;
  getDevices?(): Promise<UsbStation[]>;
};

export const usbIdentity = (device: UsbStation): StationIdentity =>
  ({ vendorId: device.vendorId, productId: device.productId, serialNumber: device.serialNumber || undefined });
export function serialIdentity(port: SerialStation): StationIdentity {
  const info = port.getInfo?.();
  return { vendorId: info?.usbVendorId, productId: info?.usbProductId };
}

/** En godkänd enhet att välja bland när flera finns. */
export type StationOption =
  | { readonly link: "usb"; readonly device: UsbStation; readonly label: string }
  | { readonly link: "serial"; readonly device: SerialStation; readonly label: string };

interface Options {
  readonly serial: SerialApi | undefined;
  readonly usb: UsbApi | undefined;
  /** Är en station (eller övningsstationen) ansluten eller på väg att anslutas? */
  readonly connected: boolean;
  /** Tävlingsdatan är inläst (stationens klocka tolkas i tävlingens tidszon). */
  readonly ready: boolean;
  readonly connectSerialPort: (port: SerialStation) => Promise<boolean>;
  readonly connectUsbDevice: (device: UsbStation) => Promise<boolean>;
  /** Labels för valen när flera enheter är godkända. */
  readonly label: (link: StationLink, index: number, identity: StationIdentity, name: string | undefined) => string;
}

/**
 * Ansluter automatiskt till den sparade stationen när sidan öppnas och när en station sätts i (`connect`-händelsen), till
 * en enhet som webbläsaren redan har godkänt (`getDevices`/`getPorts`). En manuell frånkoppling pausar till nästa manuella
 * anslutning (eller tills sidan öppnas igen). Fel visas som besked, aldrig tyst.
 */
export function useStationAutoConnect(options: Options) {
  const [remembered, setRemembered] = useState<RememberedStation | undefined>(() => loadRememberedStation());
  const [paused, setPaused] = useState(false);
  const [choices, setChoices] = useState<StationOption[]>();
  const [problem, setProblem] = useState<string>();
  const latest = useRef(options);
  latest.current = options;
  const state = useRef({ remembered, paused, running: false });
  state.current = { ...state.current, remembered, paused };

  const attempt = useCallback(async () => {
    const { serial, usb, connected, ready, connectSerialPort, connectUsbDevice, label } = latest.current;
    const saved = state.current.remembered;
    if (!saved || !ready || state.current.paused || connected || state.current.running) return;
    state.current.running = true;
    try {
      if (saved.link === "usb") {
        if (!usb?.getDevices) return;
        const devices = (await usb.getDevices()).filter((device) => device.vendorId === CP210X_VENDOR_ID);
        const choice = chooseStation(devices, saved, usbIdentity);
        setChoices(choice.kind === "ask" ? choice.devices.map((device, index) =>
          ({ link: "usb", device, label: label("usb", index, usbIdentity(device), device.productName) })) : undefined);
        if (choice.kind === "one") await connectUsbDevice(choice.device);
      } else {
        if (!serial?.getPorts) return;
        const ports = await serial.getPorts();
        const choice = chooseStation(ports, saved, serialIdentity);
        setChoices(choice.kind === "ask" ? choice.devices.map((device, index) =>
          ({ link: "serial", device, label: label("serial", index, serialIdentity(device), undefined) })) : undefined);
        if (choice.kind === "one") await connectSerialPort(choice.device);
      }
      setProblem(undefined);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      state.current.running = false;
    }
  }, []);

  // När sidan öppnas (och när valet ändras) och varje gång en station sätts i.
  useEffect(() => {
    void attempt();
    const { serial, usb } = latest.current;
    const plugged = () => { void attempt(); };
    serial?.addEventListener?.("connect", plugged);
    usb?.addEventListener?.("connect", plugged);
    return () => { serial?.removeEventListener?.("connect", plugged); usb?.removeEventListener?.("connect", plugged); };
  }, [attempt, remembered, paused, options.ready]);

  /** En lyckad manuell anslutning: kom ihåg stationen och sluta pausa. */
  const remember = useCallback((link: StationLink, identity: StationIdentity) => {
    setRemembered(rememberStation(link, identity)); setPaused(false); setChoices(undefined); setProblem(undefined);
  }, []);
  /** Manuell frånkoppling: ingen automatisk återanslutning direkt. */
  const pause = useCallback(() => { setPaused(true); setChoices(undefined); }, []);
  /** "Sluta ansluta automatiskt". */
  const stop = useCallback(() => { forgetStation(); setRemembered(undefined); setChoices(undefined); setProblem(undefined); }, []);
  /** Användaren valde en av flera godkända enheter. */
  const choose = useCallback(async (option: StationOption) => {
    setChoices(undefined);
    if (option.link === "usb") {
      if (await latest.current.connectUsbDevice(option.device)) remember("usb", usbIdentity(option.device));
    } else if (await latest.current.connectSerialPort(option.device)) remember("serial", serialIdentity(option.device));
  }, [remember]);

  // Automatisk anslutning går bara när webbläsaren kan lista godkända enheter för det sparade sättet.
  const supported = remembered?.link === "usb" ? !!options.usb?.getDevices : remembered?.link === "serial" ? !!options.serial?.getPorts : false;
  return { remembered: supported ? remembered : undefined, paused, choices, problem, remember, pause, stop, choose };
}
