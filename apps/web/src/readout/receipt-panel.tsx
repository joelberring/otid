import { useEffect, useMemo, useRef, useState } from "react";
import { readoutTextEn } from "./text-en";
import { useTexts } from "../components/language-provider";
import type { ReadoutPackage } from "@o-tid/contracts";
import type { LocalVerdict } from "./evaluate";
import { BluetoothPrinter } from "./bluetooth-printer";
import { receiptToEscPos } from "./escpos";
import { buildReceipt } from "./receipt";
import type { BluetoothLike } from "./reader-bt";
import { ReceiptView } from "./receipt-view";
import { receiptPageCss, type ReceiptSettings } from "./receipt-settings";
import { readoutText } from "./text-sv";

const PAGE_STYLE_ID = "otid-receipt-page";
/** Web Bluetooth (Chrome/Edge på dator och Android, Bluefy på iPhone/iPad): kvittoskrivare över Bluetooth. */
const bluetooth = typeof navigator !== "undefined" ? (navigator as Navigator & { bluetooth?: BluetoothLike }).bluetooth : undefined;

/**
 * Avläsningen som kvittot gäller: det senaste beskedet med underlag. Steg 57: `placement` är placeringens rader ur
 * serverns kvitto; `placementPending` när avläsningen just skickas (automatisk utskrift väntar då en stund på den).
 */
export interface Printable { readonly localSequence: number; readonly cardNumber: string; readonly verdict: LocalVerdict;
  readonly placement?: readonly string[]; readonly placementPending?: boolean }

/** Så länge väntar den automatiska utskriften på placeringen när nätet finns. */
const PLACEMENT_WAIT_MS = 2_000;

/** Godkänd eller felstämplad: en känd löpare med ett resultat att ta med sig. */
export function autoPrintable(verdict: LocalVerdict): boolean {
  return verdict.status === "OK" || verdict.status === "OVERTIME" || verdict.status === "MP";
}

/**
 * "Skriv ut kvitto" efter beskedet (PLAN.md steg 21): en stor knapp, valet att skriva ut automatiskt, QR-koden på
 * skärmen och kvittoskrivarens bredd (per enhet). Kvittot visas som förhandsvisning och är det enda som skrivs ut.
 * Allt finns lokalt, så utskriften fungerar utan nät.
 */
export function ReceiptPanel({ printable, pkg, settings, onSettings }: {
  printable: Printable | undefined; pkg: ReadoutPackage | undefined; settings: ReceiptSettings; onSettings: (settings: ReceiptSettings) => void;
}) {
  const readoutTexts = useTexts(readoutText, readoutTextEn), t = readoutTexts.receipt;
  const [shown, setShown] = useState<{ sequence: number; printedAt: Date }>();
  const [printRequest, setPrintRequest] = useState(0);
  const receiptRef = useRef<HTMLDivElement>(null);
  // Kvittoskrivaren över Bluetooth: ansluts med en knapp varje gång sidan öppnas (webbläsaren minns den inte säkert).
  const [printer, setPrinter] = useState<BluetoothPrinter>();
  const [printerProblem, setPrinterProblem] = useState<string>();
  const useBluetooth = settings.printer === "bluetooth" && !!bluetooth;
  // Den avläsning som senast skrevs ut automatiskt (eller som syntes när valet slogs på): skrivs inte ut igen.
  const autoHandled = useRef<number | undefined>(printable?.localSequence);

  const receipt = useMemo(() => printable && pkg && shown?.sequence === printable.localSequence
    ? buildReceipt({ verdict: printable.verdict, cardNumber: printable.cardNumber, pkg, origin: window.location.origin, printedAt: shown.printedAt,
      placement: printable.placement, text: readoutTexts })
    : undefined, [printable, pkg, shown, readoutTexts]);

  function print(sequence: number) {
    setShown({ sequence, printedAt: new Date() });
    setPrintRequest((count) => count + 1);
  }

  // Steg 57: medan avläsningen skickas väntar utskriften högst två sekunder på placeringen; utan nät skrivs den ut direkt.
  const sequence = printable?.localSequence;
  const pending = printable?.placementPending === true;
  const printableRef = useRef(printable);
  printableRef.current = printable;
  useEffect(() => {
    const now = printableRef.current;
    if (!now || sequence === undefined || !settings.auto || autoHandled.current === sequence) return;
    const go = () => {
      autoHandled.current = sequence;
      if (printableRef.current && autoPrintable(printableRef.current.verdict)) print(sequence);
    };
    if (!pending || !autoPrintable(now.verdict)) { go(); return; }
    const timer = setTimeout(go, PLACEMENT_WAIT_MS);
    return () => clearTimeout(timer);
  }, [sequence, pending, settings.auto]);

  useEffect(() => {
    if (printRequest === 0) return;
    if (useBluetooth) {
      if (!receipt) return;
      if (!printer) { setPrinterProblem(t.printerNone); return; }
      setPrinterProblem(undefined);
      printer.print(receiptToEscPos(receipt, { paperMm: settings.paperMm, text: t }))
        .catch((error: unknown) => setPrinterProblem(t.printerFailed(error instanceof Error ? error.message : String(error))));
      return;
    }
    if (!receiptRef.current) return;
    let style = document.getElementById(PAGE_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = PAGE_STYLE_ID;
      document.head.append(style);
    }
    style.textContent = receiptPageCss(settings.paperMm, receiptRef.current.getBoundingClientRect().height);
    window.print();
  }, [printRequest]);

  async function connectPrinter() {
    if (!bluetooth) { setPrinterProblem(t.printerUnsupported); return; }
    try {
      const next = await BluetoothPrinter.request(bluetooth);
      printer?.disconnect();
      setPrinter(next); setPrinterProblem(undefined);
      // SPORTidents skrivare har 58 mm papper.
      if (next.name.startsWith("SI Printer") && settings.paperMm !== 58) change({ paperMm: 58 });
    } catch (error) {
      // Avbrutet val i webbläsaren är inget fel.
      if (error instanceof Error && error.name === "NotFoundError") return;
      setPrinterProblem(t.printerFailed(error instanceof Error ? error.message : String(error)));
    }
  }

  function change(patch: Partial<ReceiptSettings>) {
    if (patch.auto) autoHandled.current = printable?.localSequence;
    onSettings({ ...settings, ...patch });
  }

  const canPrint = !!printable && !!pkg;
  return <section className="receipt-panel" aria-label={t.region}>
    <div className="receipt-actions">
      {canPrint ? <button type="button" className="print" onClick={() => print(printable.localSequence)}>{t.print}</button> : null}
      <label className="toggle"><input type="checkbox" checked={settings.auto} onChange={(event) => change({ auto: event.target.checked })} />
        <span>{t.auto}</span></label>
      <label className="toggle"><input type="checkbox" checked={settings.showQr} onChange={(event) => change({ showQr: event.target.checked })} />
        <span>{t.showQr}</span></label>
      <label className="paper">{t.paper}
        <select value={settings.paperMm} onChange={(event) => change({ paperMm: event.target.value === "58" ? 58 : 80 })}>
          {[80, 58].map((millimetres) => <option key={millimetres} value={millimetres}>{t.paperOption(millimetres)}</option>)}
        </select></label>
      {bluetooth ? <label className="paper">{t.printer}
        <select value={settings.printer} onChange={(event) => change({ printer: event.target.value === "bluetooth" ? "bluetooth" : "browser" })}>
          <option value="browser">{t.printerBrowser}</option>
          <option value="bluetooth">{t.printerBluetooth}</option>
        </select></label> : null}
      {useBluetooth ? <>
        <button type="button" onClick={() => { void connectPrinter(); }}>{printer ? t.changePrinter : t.connectPrinter}</button>
        <span data-testid="printer-status">{printer ? t.printerConnected(printer.name) : t.printerNone}</span>
      </> : null}
    </div>
    {printerProblem ? <p className="notice" role="alert">{printerProblem}</p> : null}
    {receipt ? <div className="receipt-preview" data-paper={settings.paperMm}>
      <div className="receipt-preview-head"><h2>{t.preview}</h2>
        <button type="button" className="quiet" onClick={() => setShown(undefined)}>{t.close}</button></div>
      <div ref={receiptRef} className="receipt-paper"><ReceiptView receipt={receipt} /></div>
    </div> : null}
  </section>;
}
