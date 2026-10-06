import { useEffect, useMemo, useRef, useState } from "react";
import type { ReadoutPackage } from "@o-tid/contracts";
import type { LocalVerdict } from "./evaluate";
import { buildReceipt } from "./receipt";
import { ReceiptView } from "./receipt-view";
import { receiptPageCss, type ReceiptSettings } from "./receipt-settings";
import { readoutText } from "./text-sv";

const t = readoutText.receipt;
const PAGE_STYLE_ID = "otid-receipt-page";

/** Avläsningen som kvittot gäller: det senaste beskedet med underlag. */
export interface Printable { readonly localSequence: number; readonly cardNumber: string; readonly verdict: LocalVerdict }

/** Godkänd eller felstämplad: en känd löpare med ett resultat att ta med sig. */
export function autoPrintable(verdict: LocalVerdict): boolean {
  return verdict.status === "OK" || verdict.status === "MP";
}

/**
 * "Skriv ut kvitto" efter beskedet (PLAN.md steg 21): en stor knapp, valet att skriva ut automatiskt, QR-koden på
 * skärmen och kvittoskrivarens bredd (per enhet). Kvittot visas som förhandsvisning och är det enda som skrivs ut.
 * Allt finns lokalt, så utskriften fungerar utan nät.
 */
export function ReceiptPanel({ printable, pkg, settings, onSettings }: {
  printable: Printable | undefined; pkg: ReadoutPackage | undefined; settings: ReceiptSettings; onSettings: (settings: ReceiptSettings) => void;
}) {
  const [shown, setShown] = useState<{ sequence: number; printedAt: Date }>();
  const [printRequest, setPrintRequest] = useState(0);
  const receiptRef = useRef<HTMLDivElement>(null);
  // Den avläsning som senast skrevs ut automatiskt (eller som syntes när valet slogs på): skrivs inte ut igen.
  const autoHandled = useRef<number | undefined>(printable?.localSequence);

  const receipt = useMemo(() => printable && pkg && shown?.sequence === printable.localSequence
    ? buildReceipt({ verdict: printable.verdict, cardNumber: printable.cardNumber, pkg, origin: window.location.origin, printedAt: shown.printedAt })
    : undefined, [printable, pkg, shown]);

  function print(sequence: number) {
    setShown({ sequence, printedAt: new Date() });
    setPrintRequest((count) => count + 1);
  }

  useEffect(() => {
    if (!printable || !settings.auto || autoHandled.current === printable.localSequence) return;
    autoHandled.current = printable.localSequence;
    if (autoPrintable(printable.verdict)) print(printable.localSequence);
  }, [printable, settings.auto]);

  useEffect(() => {
    if (printRequest === 0 || !receiptRef.current) return;
    let style = document.getElementById(PAGE_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = PAGE_STYLE_ID;
      document.head.append(style);
    }
    style.textContent = receiptPageCss(settings.paperMm, receiptRef.current.getBoundingClientRect().height);
    window.print();
  }, [printRequest]);

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
    </div>
    {receipt ? <div className="receipt-preview" data-paper={settings.paperMm}>
      <div className="receipt-preview-head"><h2>{t.preview}</h2>
        <button type="button" className="quiet" onClick={() => setShown(undefined)}>{t.close}</button></div>
      <div ref={receiptRef} className="receipt-paper"><ReceiptView receipt={receipt} /></div>
    </div> : null}
  </section>;
}
