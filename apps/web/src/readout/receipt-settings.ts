/**
 * Kvittots inställningar per enhet (PLAN.md steg 21): skriv ut automatiskt, visa QR-kod på skärmen och
 * kvittoskrivarens bredd. Sparas i webbläsaren; går det inte (privat läge) gäller förvalen och en varning loggas.
 */
export interface ReceiptSettings {
  readonly auto: boolean;
  readonly showQr: boolean;
  readonly paperMm: 80 | 58;
}

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = { auto: false, showQr: true, paperMm: 80 };
const KEY = "otid.readout.receipt.v1";

type SettingsStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): SettingsStorage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

export function loadReceiptSettings(storage: SettingsStorage | undefined = browserStorage()): ReceiptSettings {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return DEFAULT_RECEIPT_SETTINGS;
    const value = JSON.parse(raw) as Partial<Record<keyof ReceiptSettings, unknown>>;
    return {
      auto: typeof value.auto === "boolean" ? value.auto : DEFAULT_RECEIPT_SETTINGS.auto,
      showQr: typeof value.showQr === "boolean" ? value.showQr : DEFAULT_RECEIPT_SETTINGS.showQr,
      paperMm: value.paperMm === 58 ? 58 : 80
    };
  } catch (error) {
    console.warn("Kvittots inställningar kunde inte läsas; förvalen gäller", error);
    return DEFAULT_RECEIPT_SETTINGS;
  }
}

export function saveReceiptSettings(settings: ReceiptSettings, storage: SettingsStorage | undefined = browserStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn("Kvittots inställningar kunde inte sparas på enheten", error);
  }
}

/**
 * Sidformatet för utskriften: kvittots bredd och exakt så lång sida som kvittot (Chromium kan inte `size: … auto`),
 * så att en kvittoskrivare inte matar ut tomt papper. Höjden mäts på förhandsvisningen, som har samma bredd.
 */
export function receiptPageCss(paperMm: number, heightPx: number): string {
  const heightMm = Math.max(40, Math.ceil(heightPx * 25.4 / 96) + 2);
  return `@page { size: ${paperMm}mm ${heightMm}mm; margin: 0; }`;
}
