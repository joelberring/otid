import { useMemo } from "react";
import { qrPath, type Receipt } from "./receipt";
import { readoutText } from "./text-sv";

const t = readoutText.receipt;

/** QR-kod som SVG, svart på vitt, skarpa kanter (även på kvittoskrivare). */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const { size, path } = useMemo(() => qrPath(value), [value]);
  return <svg className={className} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges"
    data-testid="qr-code" data-url={value}>
    <rect width={size} height={size} fill="#fff" />
    <path d={path} fill="#000" />
  </svg>;
}

/**
 * Kvittot för 58/80 mm kvittoskrivare (PLAN.md steg 21): svart text, tabellsiffror, inga knappar. Samma markering
 * visas som förhandsvisning på skärmen och är det enda som skrivs ut.
 */
export function ReceiptView({ receipt }: { receipt: Receipt }) {
  return <article className="receipt" data-testid="receipt" aria-label={t.region}>
    <header>
      <p className="receipt-event">{receipt.eventName}</p>
      <p>{receipt.details}</p>
    </header>
    <section>
      {receipt.runner ? <p className="receipt-runner">{receipt.runner}</p> : null}
      {receipt.team ? <p>{receipt.team}</p> : null}
      <p>{receipt.card}</p>
    </section>
    <section className="receipt-status">
      <p><strong>{receipt.symbol} {receipt.status}</strong>{receipt.result ? <strong className="receipt-result">{receipt.result}</strong> : null}</p>
      {receipt.notes.map((note) => <p key={note}>{note}</p>)}
      {receipt.lines.length > 0 ? <dl>{receipt.lines.map((line) => <div key={line.label}><dt>{line.label}</dt><dd>{line.value}</dd></div>)}</dl>
        : null}
    </section>
    <section>
      {receipt.rows.length === 0 ? <p>{t.noSplits}</p> : <table className="receipt-splits">
        <thead><tr>{receipt.columns.map((column, index) => <th key={index} scope="col">{column}</th>)}</tr></thead>
        <tbody>{receipt.rows.map((row, index) => <tr key={index}>
          <td>{row.index}</td><td>{row.code}</td><td>{row.leg}</td><td>{row.total}</td>
        </tr>)}</tbody>
      </table>}
    </section>
    <footer>
      <QrCode value={receipt.qr.url} label={t.scan} className="receipt-qr" />
      <p>{t.scan}</p>
      <p className="receipt-address">{receipt.qr.address}</p>
      <p className="receipt-printed">{receipt.printedAt} · {t.footer}</p>
    </footer>
  </article>;
}
