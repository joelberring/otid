"use client";

import { useEffect, useMemo, useState } from "react";
import { runnerControlMapSchema, type RunnerControlMap } from "@o-tid/contracts";
import { controlMapSv as text } from "../../i18n/control-map-sv";
import { controlMapView, typicalSpacing } from "../../lib/control-map";
import { runnerDrawing, runnerMessages } from "./control-map-drawing";
import { ControlMapSvg } from "./control-map-svg";
import styles from "./control-map.module.css";

/**
 * Steg 52 (ADR-0176): löparens bana på kartan med stämplingarna (deltagarkortet och den publika deltagarsidan). En
 * stafett- eller teamsprintlöpare med flera sträckor väljer sträcka. Utan lägen: kontrollerna i ordning och beskeden.
 */
export function RunnerControlMapView({ data, imageHref }: { data: RunnerControlMap; imageHref?: string | undefined }) {
  const [index, setIndex] = useState(0);
  const leg = data.legs[Math.min(index, data.legs.length - 1)]!;
  const view = useMemo(() => controlMapView(data.bounds, data.map,
    typicalSpacing(data.controls.flatMap(control => control.position ? [control.position] : []))), [data]);
  const drawing = useMemo(() => view ? runnerDrawing(data, leg, view) : undefined, [data, leg, view]);
  const messages = runnerMessages(leg);
  return <section className={styles.runner} aria-label={text.runnerMapLabel(data.name)}>
    {data.legs.length > 1 && <div className={styles.legTabs} role="group" aria-label={text.mode}>
      {data.legs.map((row, legIndex) => <button key={legIndex} type="button" className="secondary" aria-pressed={legIndex === index}
        onClick={() => setIndex(legIndex)}>{row.leg ? text.leg(row.leg) : row.courseName}</button>)}
    </div>}
    <p className={styles.muted}>{leg.leg ? `${text.leg(leg.leg)} · ` : ""}{leg.courseName}{leg.variantCode ? ` · ${leg.variantCode}` : ""}</p>
    {view && drawing && <ControlMapSvg view={view} controls={drawing.controls} lines={drawing.lines} ends={drawing.ends}
      metersPerUnit={data.metersPerUnit} label={text.runnerMapLabel(data.name)}
      image={imageHref && data.map ? { href: imageHref, width: data.map.width, height: data.map.height } : undefined} />}
    {!view && <p className={styles.codes}><strong>{text.courseOnly}</strong> {leg.controlCodes.join(" ")}</p>}
    {leg.marks === null ? <p className={styles.muted}>{text.noReadout}</p>
      : messages.length === 0 ? <p className={styles.muted} role="status">{text.allPunched}</p>
        : <ul className={styles.messages}>{messages.map(message => <li key={message.key} data-mark={message.mark}>{message.text}</li>)}</ul>}
    {view && leg.marks !== null && <p className={styles.muted}>{text.legendRunner}</p>}
  </section>;
}

/**
 * Deltagarkortet: "Visa på kartan" hämtar löparens karta när den öppnas (och kartbilden när kartan är georefererad). Egen
 * hämtning utanför arbetsytans anropskö, så att den aldrig avbryter kortets andra läsningar (resultatet).
 */
export function ParticipantControlMap({ raceId, entryId, refreshKey }: { raceId: string; entryId: string; refreshKey: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<RunnerControlMap>();
  const [image, setImage] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const base = `/api/admin/races/${raceId}/administrator`;
    void (async () => {
      try {
        setFailed(false);
        const response = await fetch(`${base}/entries/${entryId}/control-map`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Kartan kunde inte hämtas");
        const next = runnerControlMapSchema.parse(await response.json());
        if (next.map && !image) {
          const imageResponse = await fetch(`${base}/map/image`, { cache: "no-store", signal: controller.signal });
          if (imageResponse.ok) setImage(URL.createObjectURL(await imageResponse.blob()));
        }
        setData(next);
      } catch { if (!controller.signal.aborted) setFailed(true); }
    })();
    return () => controller.abort();
  }, [open, raceId, entryId, refreshKey]);
  useEffect(() => () => { if (image) URL.revokeObjectURL(image); }, [image]);
  return <section className={styles.runner} aria-label={text.showOnMap}>
    <div><button type="button" className="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>
      {open ? text.hideMap : text.showOnMap}</button></div>
    {open && failed && <p role="alert">{text.failed}</p>}
    {open && !data && !failed && <p role="status" className={styles.muted}>{text.loading}</p>}
    {open && data && <RunnerControlMapView data={data} imageHref={image} />}
  </section>;
}

/** Den publika deltagarsidan: "Visa på kartan" när banorna är publika (ADR-0176). Inga andra löpares data. */
export function PublicRunnerControlMap({ raceId, publicResultId }: { raceId: string; publicResultId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<RunnerControlMap>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open || data) return;
    let disposed = false;
    void (async () => {
      try {
        const response = await fetch(`/api/public/races/${raceId}/results/${publicResultId}/control-map`, { cache: "no-store" });
        if (!response.ok) throw new Error("Kartan kunde inte hämtas");
        const parsed = runnerControlMapSchema.parse(await response.json());
        if (!disposed) setData(parsed);
      } catch { if (!disposed) setFailed(true); }
    })();
    return () => { disposed = true; };
  }, [open, data, raceId, publicResultId]);
  return <section className={styles.runner} aria-label={text.showOnMap}>
    <div><button type="button" className="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>
      {open ? text.hideMap : text.showOnMap}</button></div>
    {open && failed && <p role="alert">{text.failed}</p>}
    {open && !data && !failed && <p role="status" className={styles.muted}>{text.loading}</p>}
    {open && data && <RunnerControlMapView data={data}
      imageHref={data.map ? `/api/public/races/${raceId}/map?v=${data.map.version}` : undefined} />}
  </section>;
}
