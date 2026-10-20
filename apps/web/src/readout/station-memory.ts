/**
 * Steg 35: avläsaren kommer ihåg stationen. När funktionären en gång har anslutit en station sparas hur (Web Serial eller
 * WebUSB) och vilken (tillverkare, produkt och serienummer när webbläsaren ger det) i den här webbläsaren. Nästa gång
 * sidan öppnas, eller när stationen sätts i igen, ansluts den utan klick till en enhet som webbläsaren redan har godkänt.
 * Sparas per webbläsare i localStorage; går det inte (privat läge) får man klicka som förut.
 */
export type StationLink = "serial" | "usb";

export interface RememberedStation {
  readonly link: StationLink;
  readonly vendorId?: number;
  readonly productId?: number;
  readonly serialNumber?: string;
}

/** Det som går att läsa om en redan godkänd enhet (WebUSB-enheten eller serieportens `getInfo()`). */
export interface StationIdentity {
  readonly vendorId?: number | undefined;
  readonly productId?: number | undefined;
  readonly serialNumber?: string | undefined;
}

export type StationChoice<T> =
  | { readonly kind: "none" }
  | { readonly kind: "one"; readonly device: T }
  | { readonly kind: "ask"; readonly devices: readonly T[] };

const KEY = "otid.readout.station.v1";
type MemoryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): MemoryStorage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

const id = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 0xffff;

export function loadRememberedStation(storage?: MemoryStorage): RememberedStation | undefined {
  try {
    const raw = (storage ?? browserStorage())?.getItem(KEY);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.link !== "serial" && value.link !== "usb") return undefined;
    return { link: value.link, ...(id(value.vendorId) ? { vendorId: value.vendorId as number } : {}),
      ...(id(value.productId) ? { productId: value.productId as number } : {}),
      ...(typeof value.serialNumber === "string" && value.serialNumber.length > 0 && value.serialNumber.length <= 128
        ? { serialNumber: value.serialNumber } : {}) };
  } catch (error) {
    console.warn("Den sparade stationen kunde inte läsas; anslut med knappen", error);
    return undefined;
  }
}

export function rememberStation(link: StationLink, identity: StationIdentity, storage?: MemoryStorage): RememberedStation {
  const value: RememberedStation = { link, ...(id(identity.vendorId) ? { vendorId: identity.vendorId! } : {}),
    ...(id(identity.productId) ? { productId: identity.productId! } : {}),
    ...(identity.serialNumber ? { serialNumber: identity.serialNumber } : {}) };
  try { (storage ?? browserStorage())?.setItem(KEY, JSON.stringify(value)); }
  catch (error) { console.warn("Stationen kunde inte sparas i webbläsaren; den ansluts inte automatiskt", error); }
  return value;
}

export function forgetStation(storage?: MemoryStorage): void {
  try { (storage ?? browserStorage())?.removeItem(KEY); }
  catch (error) { console.warn("Den sparade stationen kunde inte tas bort", error); }
}

/**
 * Vilken av de redan godkända enheterna som ska anslutas: den senast använda (samma serienummer, annars samma
 * tillverkare och produkt), annars den enda. Finns flera och ingen pekas ut får användaren välja.
 */
export function chooseStation<T>(devices: readonly T[], remembered: RememberedStation | undefined,
  identify: (device: T) => StationIdentity): StationChoice<T> {
  if (devices.length === 0) return { kind: "none" };
  if (remembered) {
    const same = (device: T) => {
      const identity = identify(device);
      return (remembered.vendorId === undefined || identity.vendorId === remembered.vendorId) &&
        (remembered.productId === undefined || identity.productId === remembered.productId);
    };
    if (remembered.serialNumber !== undefined) {
      const exact = devices.filter((device) => same(device) && identify(device).serialNumber === remembered.serialNumber);
      if (exact.length === 1) return { kind: "one", device: exact[0]! };
    }
    // Utan serienummer (Web Serial ger inget) räcker samma tillverkare och produkt om bara en enhet har dem.
    const similar = devices.filter(same);
    if (remembered.serialNumber === undefined && similar.length === 1) return { kind: "one", device: similar[0]! };
  }
  return devices.length === 1 ? { kind: "one", device: devices[0]! } : { kind: "ask", devices };
}
