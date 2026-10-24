"use client";

import Link from "next/link";
import type { PartyTheme } from "@o-tid/contracts";
import { partyLook, partyThemeStyle } from "../../lib/party-theme-style";
import { partyPublicSv as text } from "../../i18n/party-public-sv";
import { Button } from "../ui";
import styles from "./party-qr.module.css";

/**
 * QR-skylten för festen (PLAN.md steg 42): A4 stående, festens utseende (Centrum OK 20 år: Poppins och centrumröd).
 * Verktygsraden syns bara på skärmen; utskriften är bara skylten, i 100 % skala.
 */
export function PartyQrSheet({ partyPath, title, eventName, theme, url, address, qrImage }: {
  partyPath: string; title: string; eventName: string; theme: PartyTheme; url: string; address: string; qrImage: string;
}) {
  return <div className={styles.page} style={partyThemeStyle(theme)} data-look={partyLook(theme)}>
    <style>{"@page { size: A4 portrait; margin: 0; }"}</style>
    <div className={styles.tools}>
      <Link href={partyPath}>{text.qr.back}</Link>
      <p>{text.qr.printHelp}</p>
      <Button onClick={() => window.print()}>{text.qr.print}</Button>
    </div>
    <article className={styles.sheet} aria-label={text.qr.title} data-testid="party-qr" data-url={url}>
      <header className={styles.band}>
        {theme.logo ? <img className={styles.logo} src={theme.logo} alt="" /> : null}
        <h1>{title}</h1>
        {title !== eventName ? <p>{eventName}</p> : null}
      </header>
      <p className={styles.line}>{text.qr.line}</p>
      {/* En SVG som data-URL från servern: skarp vid utskrift. */}
      <img className={styles.code} src={qrImage} alt={text.qr.image(eventName)} />
      <p className={styles.scan}>{text.qr.scan}</p>
      <p className={styles.address}>{address}</p>
      <ol className={styles.howTo} aria-label={text.howToLabel}>{text.howTo.map(row => <li key={row}>{row}</li>)}</ol>
    </article>
  </div>;
}
