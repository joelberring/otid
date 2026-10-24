"use client";

import { useEffect, useState } from "react";
import { partyStateResponseSchema, type PartyStateResponse } from "@o-tid/contracts";
import { formatPartyKronor } from "@o-tid/domain";
import { partySv as text } from "../../i18n/party-sv";
import styles from "./party-labels.module.css";

/**
 * Etiketter till kontrollenheterna (PLAN.md steg 40): varans namn stort, priset tydligt och koden smått i hörnet, två
 * per vara, och en för målenheten. Rutnät på A4 med tunna skärlinjer; storleken väljs (standard 45 × 30 mm, som får
 * plats på en BSF8 utan att täcka stämplingshålet). Utskrift i 100 % skala.
 */
const SIZES = { SMALL: { width: 45, height: 30 }, MEDIUM: { width: 60, height: 35 }, LARGE: { width: 90, height: 45 } } as const;
type Size = keyof typeof SIZES;

export function PartyLabels({ raceId }: { raceId: string }) {
  const [state, setState] = useState<PartyStateResponse>();
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState<Size>("SMALL");
  useEffect(() => {
    void fetch(`/api/admin/races/${encodeURIComponent(raceId)}/administrator/party`, { credentials: "same-origin", cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error(String(response.status)); setState(partyStateResponseSchema.parse(await response.json())); })
      .catch(() => setFailed(true));
  }, [raceId]);
  const items = state?.items.filter(item => !item.hidden) ?? [];
  const { width, height } = SIZES[size];
  return <main className={styles.page}>
    <div className={styles.controls}>
      <h1>{text.labelsTitle}</h1>
      <p>{text.labelsPrintHelp}</p>
      <label>{text.labelSize}
        <select value={size} onChange={event => setSize(event.target.value as Size)}>
          {(Object.keys(SIZES) as Size[]).map(key => <option key={key} value={key}>{text.labelSizes[key]}</option>)}
        </select></label>
      <button type="button" onClick={() => window.print()}>{text.print}</button>
      {failed ? <p role="alert">{text.loadError}</p> : !state ? <p role="status">{text.loading}</p> : items.length === 0 ? <p>{text.labelsEmpty}</p> : null}
    </div>
    <div className={styles.sheet} data-size={size} style={{ gridTemplateColumns: `repeat(auto-fill, ${width}mm)`, gridAutoRows: `${height}mm` }}
      data-testid="party-labels">
      {items.flatMap(item => [0, 1].map(copy => <div key={`${item.id}-${copy}`} className={styles.label}>
        <span className={styles.code}>{text.labelCode(item.code)}</span>
        <strong className={styles.name}>{item.name}</strong>
        <span className={styles.price}>{formatPartyKronor(item.priceOre).replace(/,00$/, "")} kr</span>
      </div>))}
      {state ? [0, 1].map(copy => <div key={`finish-${copy}`} className={`${styles.label} ${styles.finish}`}>
        <strong className={styles.name}>{text.labelFinish}</strong>
        <span className={styles.price}>{text.labelFinishHelp}</span>
      </div>) : null}
    </div>
  </main>;
}
