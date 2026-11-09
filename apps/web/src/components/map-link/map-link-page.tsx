"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { mapLinkEn } from "../../i18n/course-setting-link-en";
import { useTexts } from "../language-provider";
import type { MapLinkError, MapLinkView, MapMakerVerdict } from "@o-tid/contracts";
import type { MapGeoreference } from "@o-tid/map-file";
import { mapLinkSv } from "../../i18n/map-link-sv";
import { insideBounds, toMapPosition, type MapPosition, type PositionFix } from "../../lib/course-setting-geo";
import { MapRenderSession } from "../../lib/course-setting-map-protocol";
import type { NoteMark } from "../../lib/course-setting-note-marks";
import { sketchBounds } from "../../lib/course-setting-sketch";
import { toScreen, type Bounds, type Viewport } from "../../lib/course-setting-viewport";
import { controlledWorker } from "../../lib/course-setting-worker";
import {
  fetchMapLinkMap, fetchMapLinkView, MapLinkHttpError, replyWithMapLink, verdictWithMapLink
} from "../../lib/map-link-api";
import { CourseSettingMap, type CourseSettingMapHandle, type MapPointerHandlers, type SketchLayer } from "../course-setting/course-setting-map";
import { EditedMark, VerdictBadge } from "../course-setting/note-text";
import { Button, Notice } from "../ui";
import styles from "./map-link-page.module.css";

const createMapWorker = () => controlledWorker(() => new Worker(new URL("../../lib/course-setting-map-worker.ts", import.meta.url), { type: "module" }));
const NAME_KEY = "otid-map-link-name";
const NO_MARKS = { selected: [], flagged: [], radiusMm: 0 };
/** Kartan panoreras med fingret eller musen; inget annat händer vid ett tryck (markeringarna väljs av kartan själv). */
const PAN_ONLY: MapPointerHandlers = { onTap: () => undefined, onDragStart: () => false, onDragMove: () => undefined, onDragEnd: () => undefined };

/** Kartfelets mitt på kartan (punkten eller ritningens ruta). */
function centerOf(error: MapLinkError): { x: number; y: number } | undefined {
  if (error.point) return error.point;
  const bounds = error.shapes ? sketchBounds(error.shapes) : undefined;
  return bounds ? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 } : undefined;
}

function readName(): string {
  try { return window.localStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; }
}
function saveName(value: string) {
  try { if (value.trim()) window.localStorage.setItem(NAME_KEY, value.trim()); else window.localStorage.removeItem(NAME_KEY); } catch { /* bara en bekvämlighet */ }
}

/** Positionen från telefonen när den är påslagen (fältläget i banläggningen, utan "Flytta hit"). */
function usePosition(active: boolean, georeference: MapGeoreference | null): { position?: MapPosition; problem?: string } {
  const mapLinkText = useTexts(mapLinkSv, mapLinkEn);
  const text = useTexts(mapLinkText.page, mapLinkEn.page);
  const [fix, setFix] = useState<PositionFix>();
  const [problem, setProblem] = useState<string>();
  useEffect(() => {
    if (!active) { setFix(undefined); setProblem(undefined); return; }
    if (!window.isSecureContext) { setProblem(text.insecure); return; }
    if (!("geolocation" in navigator)) { setProblem(text.noGeolocation); return; }
    const id = navigator.geolocation.watchPosition(position => {
      setFix({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyM: position.coords.accuracy });
      setProblem(undefined);
    }, failure => setProblem(failure.code === failure.PERMISSION_DENIED ? text.denied : text.positionFailed),
    { enableHighAccuracy: true, maximumAge: 0 });
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);
  return useMemo(() => {
    if (problem) return { problem };
    if (!fix || !georeference) return {};
    try { return { position: toMapPosition(georeference, fix) }; } catch { return { problem: text.unsupportedCrs }; }
  }, [fix, georeference, problem]);
}

/**
 * ADR-0214: sidan som kartritaren öppnar med länken (`/kartfel/<nyckel>`), utan konto. Kartan ritas i webbläsaren ur
 * kartfilen (samma Worker som banläggningen) med kartfelens markeringar och ritningar och deras löpnummer; listan under
 * (på bred skärm bredvid). Ett tryck på ett kartfel öppnar tråden: svara, "Åtgärdat i kartan" eller "Inte åtgärdat" med
 * en valfri kommentar. Namnet (valfritt) skrivs en gång och sparas i telefonen. "Min position" när kartan är georefererad.
 * Inga banor, kontroller eller nummer på kontroller finns på sidan: servern lämnar inte ut dem.
 */
export function MapLinkPage({ token, initial }: { token: string; initial: MapLinkView }) {
  const mapLinkText = useTexts(mapLinkSv, mapLinkEn);
  const text = useTexts(mapLinkText.page, mapLinkEn.page);
  const [view, setView] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [name, setName] = useState("");
  useEffect(() => setName(readName()), []);
  const [replies, setReplies] = useState<Readonly<Record<string, string>>>({});
  const [comments, setComments] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const map = useRef<CourseSettingMapHandle>(null);

  async function refresh() {
    try { setView(await fetchMapLinkView(token)); }
    catch (error) { if (error instanceof MapLinkHttpError && error.status === 404) setInvalid(true); else throw error; }
  }
  async function act(action: () => Promise<void>): Promise<boolean> {
    setBusy(true); setFailed(false);
    try { saveName(name); await action(); await refresh(); return true; } catch (error) {
      if (error instanceof MapLinkHttpError && error.status === 404) { await refresh().catch(() => undefined); }
      console.error("Kartritarens svar sparades inte", error);
      setFailed(true);
      return false;
    } finally { setBusy(false); }
  }

  // Kartfilen i en Worker (som i banläggningen).
  const [session, setSession] = useState<MapRenderSession>();
  const [bounds, setBounds] = useState<Bounds>();
  const [georeference, setGeoreference] = useState<MapGeoreference | null>(null);
  const [mapState, setMapState] = useState<"none" | "reading" | "ready" | "failed">(initial.map ? "reading" : "none");
  const hasMap = view.map !== null;
  useEffect(() => {
    if (!hasMap) return;
    const controller = new AbortController();
    let created: MapRenderSession | undefined;
    setMapState("reading");
    void fetchMapLinkMap(token, controller.signal).then(file => {
      created = new MapRenderSession(createMapWorker, (loadedBounds, _scale, georef) => {
        setBounds(loadedBounds); setGeoreference(georef); setSession(created); setMapState("ready");
      }, () => setMapState("failed"));
      created.load(file.bytes, file.fileName);
    }, (error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof MapLinkHttpError && error.status === 404) void refresh().catch(() => undefined);
      setMapState("failed");
    });
    return () => { controller.abort(); created?.close(); };
  }, [token, hasMap]);

  const [tracking, setTracking] = useState<"off" | "show" | "follow">("off");
  const located = usePosition(tracking !== "off", georeference);
  const outside = located.position && bounds ? !insideBounds(located.position.at, bounds) : false;

  const errors = view.mapErrors;
  const marks = useMemo<NoteMark[]>(() => errors.flatMap(error => error.point ? [{ id: error.id, at: error.point, status: error.status, count: 1 }] : []),
    [errors]);
  const sketches = useMemo<SketchLayer>(() => ({ notes: errors.flatMap(error => error.shapes ? [{ id: error.id, shapes: error.shapes,
    done: error.status === "DONE" }] : []) }), [errors]);
  const numbers = useMemo(() => errors.flatMap(error => { const at = centerOf(error); return at ? [{ at, number: error.number, point: error.point !== null }] : []; }),
    [errors]);
  const overlay = useMemo(() => (ctx: CanvasRenderingContext2D, current: Viewport) => {
    ctx.save();
    ctx.font = "bold 15px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const item of numbers) {
      const at = toScreen(current, item.at);
      // Numret till vänster om punktens flagga, eller mitt på ritningen.
      const x = item.point ? at.x - 16 : at.x, y = item.point ? at.y + 4 : at.y;
      ctx.lineWidth = 4; ctx.strokeStyle = "#fff"; ctx.strokeText(String(item.number), x, y);
      ctx.fillStyle = "rgb(170, 10, 20)"; ctx.fillText(String(item.number), x, y);
    }
    ctx.restore();
  }, [numbers]);

  function choose(id: string | undefined, fromMap: boolean) {
    setSelected(id);
    const error = errors.find(row => row.id === id);
    if (!error) return;
    if (fromMap) { window.document.getElementById(`map-error-${error.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); return; }
    const box = error.shapes ? sketchBounds(error.shapes) : undefined;
    if (box) map.current?.reveal([{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.maxY }]);
    else if (error.point) map.current?.focus(error.point);
  }

  if (invalid) return <main className={styles.page}><section className={styles.invalid}><h1>{text.invalidTitle}</h1>
    <p role="alert">{text.invalid}</p></section></main>;

  const verdict = (error: MapLinkError, value: MapMakerVerdict) => void act(async () => {
    await verdictWithMapLink(token, error.id, value, comments[error.id]?.trim() ?? "", name.trim() || null);
    setComments(current => ({ ...current, [error.id]: "" }));
  });

  return <main className={styles.page} data-testid="map-link-page">
    <header className={styles.head}>
      {view.raceName && <p className={styles.kicker} data-testid="map-link-race">{view.raceName}</p>}
      <h1>{text.title}</h1>
      <p>{text.intro}</p>
    </header>
    <div className={styles.layout}>
      <section className={styles.mapArea} aria-label={text.mapLabel}>
        {hasMap && mapState === "ready" && bounds ? <div className={styles.mapBox}>
          <CourseSettingMap session={session} mapBounds={bounds} primitives={[]} faded={[]} marks={NO_MARKS} analysis={undefined}
            label={text.mapLabel} cursor="grab" handlers={PAN_ONLY} handle={map} noteMarks={marks} sketches={sketches} selectedNote={selected}
            onNoteTap={id => choose(id, true)} overlayExtra={overlay} onPan={() => setTracking(current => current === "follow" ? "show" : current)}
            position={located.position ? { position: located.position, follow: tracking === "follow" } : undefined} />
        </div> : <p className={styles.mapNote} role="status">
          {!hasMap ? text.noMap : mapState === "failed" ? text.mapFailed : text.mapLoading}</p>}
        {hasMap && <div className={styles.row}>
          <Button variant="secondary" aria-pressed={tracking !== "off"} disabled={!view.map?.georeferenced || mapState !== "ready"}
            onClick={() => setTracking(current => current === "off" ? "follow" : "off")}>{tracking === "off" ? text.position : text.positionOff}</Button>
          {!view.map?.georeferenced && <span className={styles.muted}>{text.noGeoref}</span>}
          {located.problem && <span className={styles.muted} role="alert">{located.problem}</span>}
          {located.position && <span className={styles.muted}>{outside ? text.outside : text.accuracy(Math.max(1, Math.round(located.position.accuracyM)))}</span>}
        </div>}
      </section>
      <section className={styles.listArea} aria-labelledby="map-link-list">
        <h2 id="map-link-list">{text.list}</h2>
        <label className={styles.name}>{text.name}<input type="text" maxLength={80} value={name} autoComplete="name"
          onChange={event => setName(event.target.value)} onBlur={() => saveName(name)} /></label>
        <p className={styles.muted}>{text.nameHelp}</p>
        {failed && <Notice tone="error" role="alert">{text.saveFailed}</Notice>}
        {errors.length === 0 ? <p>{text.none}</p> : <ol className={styles.list}>
          {errors.map(error => <li key={error.id} id={`map-error-${error.id}`} data-testid="map-link-error" data-status={error.status}
            data-selected={error.id === selected || undefined}>
            <button type="button" className={styles.itemHead} aria-expanded={error.id === selected}
              onClick={() => choose(error.id === selected ? undefined : error.id, false)}>
              <span className={styles.number}>{text.number(error.number)}</span>
              <span className={styles.status} data-status={error.status}>{text.status[error.status]}</span>
              <span className={styles.text}>{error.text} <EditedMark editedAt={error.editedAt} /></span>
              {error.replies.length > 0 && <span className={styles.muted}>{text.replies(error.replies.length)}</span>}
            </button>
            {error.id === selected && <div className={styles.thread}>
              {error.replies.length > 0 && <ul className={styles.replies}>{error.replies.map(reply => <li key={reply.id} data-testid="map-link-reply">
                <VerdictBadge verdict={reply.verdict} />
                {reply.text && <span className={styles.text}>{reply.text}</span>} <EditedMark editedAt={reply.editedAt} />
                <span className={styles.muted}> – {reply.author ?? (reply.mapMaker ? text.mapMaker : text.courseSetter)}
                  {reply.createdAt && <>, {mapLinkText.time(reply.createdAt)}</>}</span>
              </li>)}</ul>}
              <form className={styles.form} onSubmit={event => {
                event.preventDefault();
                const value = replies[error.id]?.trim();
                if (value && !busy) void act(async () => {
                  await replyWithMapLink(token, error.id, value, name.trim() || null);
                  setReplies(current => ({ ...current, [error.id]: "" }));
                });
              }}>
                <label>{text.reply}<textarea rows={2} maxLength={2000} value={replies[error.id] ?? ""}
                  onChange={event => setReplies(current => ({ ...current, [error.id]: event.target.value }))} /></label>
                <Button type="submit" variant="secondary" disabled={busy || !replies[error.id]?.trim()}>{text.sendReply}</Button>
              </form>
              <div className={styles.form}>
                <label>{text.verdictNote}<input type="text" maxLength={2000} value={comments[error.id] ?? ""}
                  onChange={event => setComments(current => ({ ...current, [error.id]: event.target.value }))} /></label>
                <div className={styles.row}>
                  <Button disabled={busy} onClick={() => verdict(error, "FIXED")}>{text.fixed}</Button>
                  <Button variant="secondary" disabled={busy} onClick={() => verdict(error, "NOT_FIXED")}>{text.notFixed}</Button>
                </div>
              </div>
            </div>}
          </li>)}
        </ol>}
      </section>
    </div>
  </main>;
}
