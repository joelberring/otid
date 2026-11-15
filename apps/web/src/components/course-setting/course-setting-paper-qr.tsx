"use client";

import { useEffect, useState } from "react";
import type { CourseSettingState } from "@o-tid/contracts";
import { PAPER_QR_LIMITS, paperQrCustomUrl, paperQrUrl, shortPaperAddress, type PaperItem, type PaperQrCode, type PaperQrTarget } from "@o-tid/course-setting";
import { paperQrEn } from "../../i18n/course-setting-paper-qr-en";
import { paperQrSv } from "../../i18n/course-setting-paper-qr-sv";
import { useTexts } from "../language-provider";
import styles from "./course-setting-print-page.module.css";

export type PaperLinkState = CourseSettingState["paperLinks"];

/**
 * Papperets QR-kod (ägaren 2026-11-16): vart den leder (tävlingens sida, bingons anmälan när bingon är på, O-Tid eller en
 * egen https-adress), storleken och texten under (adressen kort, egen text eller ingen).
 */
export function QrFields({ item, links, readOnly, onChange }: { item: PaperQrCode; links: PaperLinkState; readOnly: boolean; onChange: (item: PaperItem) => void }) {
  const text = useTexts(paperQrSv, paperQrEn);
  const [url, setUrl] = useState(item.url ?? "");
  const [size, setSize] = useState(String(item.sizeMm));
  const [caption, setCaption] = useState(item.caption ?? "");
  const [urlError, setUrlError] = useState(false);
  // "Egen adress" vald men ingen giltig adress än: fältet visas, elementet ändras först när adressen duger.
  const [customOpen, setCustomOpen] = useState(false);
  useEffect(() => { setUrl(item.url ?? ""); setSize(String(item.sizeMm)); setCaption(item.caption ?? ""); setUrlError(false); setCustomOpen(false); }, [item]);
  const targets = (["RACE", "BINGO", "OTID", "CUSTOM"] as const).filter(target => target !== "BINGO" || links?.bingo || item.target === "BINGO");
  const setTarget = (target: PaperQrTarget) => {
    if (target !== "CUSTOM") { setCustomOpen(false); const next: PaperQrCode = { ...item, target }; delete (next as { url?: string }).url; onChange(next); return; }
    const own = paperQrCustomUrl(url);
    if (own) { onChange({ ...item, target, url: own }); return; }
    setCustomOpen(true);
    if (url === "") setUrl("https://");
  };
  const commitUrl = () => {
    const own = paperQrCustomUrl(url);
    setUrlError(!own);
    if (own && (own !== item.url || item.target !== "CUSTOM")) onChange({ ...item, target: "CUSTOM", url: own });
  };
  const custom = item.target === "CUSTOM" || customOpen;
  const commitSize = () => {
    const value = Number(size.replace(",", "."));
    if (!Number.isFinite(value)) { setSize(String(item.sizeMm)); return; }
    const next = Math.round(Math.max(PAPER_QR_LIMITS.minMm, Math.min(PAPER_QR_LIMITS.maxMm, value)) * 10) / 10;
    setSize(String(next));
    if (next !== item.sizeMm) onChange({ ...item, sizeMm: next });
  };
  const mode = item.caption === undefined ? "AUTO" : item.caption === "" ? "NONE" : "OWN";
  const setMode = (value: string) => {
    if (value === "AUTO") { const next: PaperQrCode = { ...item }; delete (next as { caption?: string }).caption; onChange(next); return; }
    if (value === "NONE") { onChange({ ...item, caption: "" }); return; }
    const address = paperQrUrl(item, links);
    onChange({ ...item, caption: caption.trim() || (address ? shortPaperAddress(address) : "QR") });
  };
  const target = paperQrUrl(item, links);
  return <div className={styles.stack} data-testid="paper-qr">
    <div className={styles.row}>
      <label className={styles.field}>{text.target}<select value={custom ? "CUSTOM" : item.target} disabled={readOnly} onChange={event => setTarget(event.target.value as PaperQrTarget)}
        data-testid="paper-qr-target">{targets.map(value => <option key={value} value={value}>{text.targets[value]}</option>)}</select></label>
      <label className={styles.field}>{text.size}<input type="number" inputMode="decimal" className={styles.small} value={size} min={PAPER_QR_LIMITS.minMm}
        max={PAPER_QR_LIMITS.maxMm} step={1} disabled={readOnly} onChange={event => setSize(event.target.value)} onBlur={commitSize}
        onKeyDown={event => { if (event.key === "Enter") commitSize(); }} data-testid="paper-qr-size" /></label>
    </div>
    {custom && <label className={styles.field}>{text.url}<input type="url" inputMode="url" className={styles.wide} value={url} disabled={readOnly}
      maxLength={PAPER_QR_LIMITS.urlLength} onChange={event => setUrl(event.target.value)} onBlur={commitUrl}
      onKeyDown={event => { if (event.key === "Enter") commitUrl(); }} aria-invalid={urlError || undefined} data-testid="paper-qr-url" /></label>}
    {urlError && <p role="alert" className={styles.paperWarning} data-testid="paper-qr-url-error">{text.urlInvalid}</p>}
    <div className={styles.row}>
      <label className={styles.field}>{text.caption}<select value={mode} disabled={readOnly} onChange={event => setMode(event.target.value)} data-testid="paper-qr-caption-mode">
        {(["AUTO", "OWN", "NONE"] as const).map(value => <option key={value} value={value}>{text.captions[value]}</option>)}</select></label>
      {mode === "OWN" && <label className={styles.field}>{text.captionText}<input className={styles.wide} value={caption} maxLength={PAPER_QR_LIMITS.captionLength}
        disabled={readOnly} onChange={event => setCaption(event.target.value)} onBlur={() => { if (caption.trim() && caption.trim() !== item.caption) onChange({ ...item, caption: caption.trim() }); }}
        data-testid="paper-qr-caption" /></label>}
    </div>
    {target && <p className={styles.muted} data-testid="paper-qr-address">{text.address(target)}</p>}
    <QrNotice items={[item]} links={links} />
    <p className={styles.muted}>{text.help}</p>
  </div>;
}

/** Den diskreta varningen: tävlingen inte publicerad, bingon av eller adressen okänd (för QR-koderna på banans papper). */
export function QrNotice({ items, links }: { items: readonly PaperItem[]; links: PaperLinkState }) {
  const text = useTexts(paperQrSv, paperQrEn);
  const codes = items.filter((item): item is PaperQrCode => item.kind === "QR_CODE" && !item.hide);
  const toRace = codes.some(item => item.target === "RACE" || item.target === "BINGO");
  const notes = [
    ...(toRace && links && !links.published ? [{ key: "published", text: text.notPublished }] : []),
    ...(links && codes.some(item => item.target === "BINGO") && !links.bingo ? [{ key: "bingo", text: text.bingoOff }] : []),
    ...(!links && codes.some(item => item.target !== "CUSTOM") ? [{ key: "unknown", text: text.unknown }] : [])
  ];
  if (notes.length === 0) return null;
  return <>{notes.map(note => <p key={note.key} role="note" className={styles.muted} data-testid={`paper-qr-${note.key}`}>{note.text}</p>)}</>;
}
