"use client";

import Link from "next/link";
import { useState } from "react";
import { publicRaceSv } from "../../i18n/public-race-sv";
import { Button } from "../ui";
import styles from "./public-race.module.css";

const text = publicRaceSv.qr;
type Size = "A4" | "A5";

/**
 * Arket med QR-koden (ADR-0172 beslut 4). Verktygsraden (tillbaka, storlek, skriv ut) syns bara på skärmen;
 * utskriften är bara arket. Hel sida skrivs på A4, halv sida på A5.
 */
export function QrSheet({ hubPath, eventName, details, qrImage, address }: {
  hubPath: string; eventName: string; details: string; qrImage: string; address: string;
}) {
  const [size, setSize] = useState<Size>("A4");
  return <div className={styles.qrPage}>
    <style>{`@page { size: ${size} portrait; margin: 12mm; }`}</style>
    <div className={styles.qrTools}>
      <Link href={hubPath}>{publicRaceSv.hub.back}</Link>
      <fieldset>
        <legend>{text.size}</legend>
        {(["A4", "A5"] as const).map(value => <label key={value}>
          <input type="radio" name="qr-size" value={value} checked={size === value} onChange={() => setSize(value)} />
          {value === "A4" ? text.a4 : text.a5}
        </label>)}
      </fieldset>
      <Button onClick={() => window.print()}>{text.print}</Button>
    </div>
    <article className={styles.sheet} data-size={size} aria-label={text.title}>
      <h1>{eventName}</h1>
      <p className={styles.sheetMeta}>{details}</p>
      <p className={styles.sheetLine}>{text.line}</p>
      {/* En SVG som data-URL från servern: skarp i alla storlekar och vid utskrift. */}
      <img src={qrImage} alt={text.image(eventName)} />
      <p className={styles.sheetScan}>{text.scan}</p>
      <p className={styles.sheetAddress}>{address}</p>
    </article>
  </div>;
}
