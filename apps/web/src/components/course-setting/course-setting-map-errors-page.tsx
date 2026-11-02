"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CourseSettingNote } from "@o-tid/contracts";
import type { CourseSettingDocument } from "@o-tid/course-setting";
import type { MapGeoreference } from "@o-tid/map-file";
import { notesSv } from "../../i18n/course-setting-notes-sv";
import {
  courseSettingNotePhotoUrl, fetchCourseSetting, fetchCourseSettingNotes, HttpError, replyCourseSettingNote, setCourseSettingNoteStatus
} from "../../lib/course-setting-api";
import { drawPointMark, drawSketchShapes } from "../../lib/course-setting-draw-sketch";
import { metersPerMm } from "../../lib/course-setting-geo";
import { MAX_RENDER_SIDE, MapRenderSession } from "../../lib/course-setting-map-protocol";
import {
  cropFor, cropTransform, mapErrorGeometry, mapErrorNotes, mapErrorsGeoJson, nearControlMeters, type CropRect, type ExportedMapError
} from "../../lib/course-setting-map-errors";
import type { NoteFilter } from "../../lib/course-setting-note-marks";
import { controlledWorker } from "../../lib/course-setting-worker";
import { fetchMapSource } from "../../lib/route-choice-api";
import { Button, Notice } from "../ui";
import styles from "./course-setting-map-errors-page.module.css";

const text = notesSv.export;
const createMapWorker = () => controlledWorker(() => new Worker(new URL("../../lib/course-setting-map-worker.ts", import.meta.url), { type: "module" }));

/** Utsnittets förstoring på papperet och bildens upplösning (kartans mm × förstoring = papperets mm). */
const ENLARGE = 1.5, DPI = 250;

/** Ett slumptal per notis och sida (samma utsnitt i förhandsvisningen och utskriften, nytt nästa gång sidan öppnas). */
function seeded(seed: number, id: string): () => number {
  let state = seed;
  for (const char of id) state = (Math.imul(state ^ char.charCodeAt(0), 2654435761) >>> 0) || 1;
  return () => { state = (Math.imul(state, 48271) % 2147483647 + 2147483647) % 2147483647 || 1; return state / 2147483647; };
}

async function renderCrop(session: MapRenderSession, note: CourseSettingNote, crop: CropRect): Promise<string> {
  const widthMm = crop.maxX - crop.minX, heightMm = crop.maxY - crop.minY;
  const pxPerMm = Math.min(DPI / 25.4 * ENLARGE, MAX_RENDER_SIDE / Math.max(widthMm, heightMm));
  const width = Math.round(widthMm * pxPerMm), height = Math.round(heightMm * pxPerMm);
  const bitmap = await new Promise<ImageBitmap>(resolve => session.render({ width, height, pxPerMm, origin: { x: crop.minX, y: crop.maxY } },
    (_id, image) => resolve(image)));
  const canvas = window.document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  // Bara kartan och kartfelet: inga ringar, sträckor, nummer eller andra objekt ur banläggningen.
  const at = cropTransform(crop, pxPerMm);
  const geometry = mapErrorGeometry(note);
  if (geometry.point) drawPointMark(ctx, at(geometry.point), 2.5 * pxPerMm);
  else drawSketchShapes(ctx, at, geometry.shapes, { widthPx: Math.max(3, 0.3 * pxPerMm) });
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  return blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/png");
}

/**
 * ADR-0181 beslut 8: `/admin/[raceId]/course-setting/map-errors`. Kartfelen till kartritaren, som inte får se banorna
 * (banhemligheten): välj vilka som följer med och om fotot gör det (förval av), se varningar för kartfel nära en kontroll
 * och påminnelsen om texten, och förhandsvisa exakt det som skrivs ut (PDF via webbläsarens utskrift) och laddas ned
 * (GeoJSON). Allt görs i webbläsaren.
 *
 * Kartritaren (behörigheten MAP) får inte banläggningen (403) och ser här bara kartfelen som servern lämnar ut (utan bana
 * och foto): utsnitten, texten och svaren, svarar, markerar klart och kan skriva ut eller ladda ned samma sak.
 */
export function MapErrorsPage({ raceId }: { raceId: string }) {
  const [document, setDocument] = useState<CourseSettingDocument | null>();
  const [notes, setNotes] = useState<readonly CourseSettingNote[]>();
  const [failed, setFailed] = useState(false);
  const [hasMap, setHasMap] = useState(false);
  const [mapMaker, setMapMaker] = useState(false);
  const reload = () => fetchCourseSettingNotes(raceId).then(list => setNotes(list.notes));
  useEffect(() => {
    void (async () => {
      try {
        const state = await fetchCourseSetting(raceId).catch((error: unknown) => {
          if (error instanceof HttpError && error.status === 403) return undefined;
          throw error;
        });
        // Kartritaren: ingen banläggning, kartfilen om den finns.
        if (!state) { setMapMaker(true); setDocument(null); setHasMap(true); }
        else { setDocument((state.setting?.document ?? null) as unknown as CourseSettingDocument | null); setHasMap(state.mapFile !== null); }
        await reload();
      } catch { setFailed(true); }
    })();
  }, [raceId]);

  // Kartfilen i en Worker (som i förhandsvisningen av utskriften).
  const [session, setSession] = useState<MapRenderSession>();
  const [georeference, setGeoreference] = useState<MapGeoreference | null>(null);
  const [mapState, setMapState] = useState<"none" | "reading" | "ready" | "failed">("none");
  useEffect(() => {
    if (!hasMap) return;
    const controller = new AbortController();
    let created: MapRenderSession | undefined;
    setMapState("reading");
    void fetchMapSource(raceId, controller.signal).then(file => {
      created = new MapRenderSession(createMapWorker, (_bounds, _scale, georef) => { setGeoreference(georef); setSession(created); setMapState("ready"); },
        () => setMapState("failed"));
      created.load(file.bytes, file.fileName);
    }, (error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof Error && error.message === "404") { setHasMap(false); setMapState("none"); } else setMapState("failed");
    });
    return () => { controller.abort(); created?.close(); };
  }, [raceId, hasMap]);

  const [status, setStatus] = useState<NoteFilter>("OPEN");
  const [seed] = useState(() => crypto.getRandomValues(new Uint32Array(1))[0]! || 1);
  const perMm = document ? metersPerMm(georeference, document.event.mapScale) : 10;
  const candidates = useMemo(() => mapErrorNotes(notes ?? []).filter(note => status === "ALL" || note.status === status).map(note => {
    const geometry = mapErrorGeometry(note);
    return { note, geometry, near: document ? nearControlMeters(geometry, document, perMm) : undefined, crop: cropFor(geometry, seeded(seed, note.id)) };
  }), [notes, status, document, perMm, seed]);
  // Med eller inte: förval med, utom nära en kontroll; fotot förval av (det kan visa en skärm eller flagga).
  const [choice, setChoice] = useState<Readonly<Record<string, { include?: boolean; photo?: boolean }>>>({});
  const included = mapMaker ? candidates : candidates.filter(row => choice[row.note.id]?.include ?? row.near === undefined);
  const withPhoto = (note: CourseSettingNote) => note.photo !== null && choice[note.id]?.photo === true;
  const [reply, setReply] = useState<Readonly<Record<string, string>>>({});
  const [actionFailed, setActionFailed] = useState(false);
  async function act(action: () => Promise<unknown>) {
    setActionFailed(false);
    try { await action(); await reload(); } catch (error) { console.error("Kartfelet sparades inte", error); setActionFailed(true); }
  }

  // Utsnitten ritas ett i taget (Workern svarar bara på den senaste beställningen).
  const [images, setImages] = useState<Readonly<Record<string, string>>>({});
  const wanted = included.filter(row => !images[row.note.id]).map(row => row.note.id).join(",");
  useEffect(() => {
    if (!session || !wanted) return;
    let stopped = false;
    void (async () => {
      for (const id of wanted.split(",")) {
        const row = candidates.find(item => item.note.id === id);
        if (!row || stopped) continue;
        const url = await renderCrop(session, row.note, row.crop);
        if (stopped) { URL.revokeObjectURL(url); return; }
        setImages(current => ({ ...current, [id]: url }));
      }
    })();
    return () => { stopped = true; };
  }, [session, wanted]);

  const exported: ExportedMapError[] = included.map((row, index) => ({ number: index + 1, text: row.note.text, status: row.note.status,
    geometry: row.geometry }));
  function download() {
    const json = JSON.stringify(mapErrorsGeoJson(exported, georeference), null, 1);
    const url = URL.createObjectURL(new Blob([json], { type: "application/geo+json" }));
    const link = Object.assign(window.document.createElement("a"), { href: url, download: "kartfel.geojson" });
    window.document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  const crsText = !georeference ? text.noGeoref : georeference.crs.kind === "EPSG" ? text.georef(`EPSG:${georeference.crs.code}`) : text.georefUnknown;
  const set = (id: string, change: { include?: boolean; photo?: boolean }) => setChoice(current => ({ ...current, [id]: { ...current[id], ...change } }));

  if (failed) return <main className={styles.page}><Notice tone="error">{text.failed}</Notice></main>;
  if (!notes || document === undefined) return <main className={styles.page}><p role="status">{text.loading}</p></main>;
  const all = mapErrorNotes(notes);
  return <main className={styles.page}>
    <section className={styles.controls} aria-labelledby="map-errors-title">
      <p><Link href={`/admin/${raceId}/course-setting`}>← {text.back}</Link></p>
      <h1 id="map-errors-title">{text.title}</h1>
      <p>{mapMaker ? text.mapMakerIntro : text.intro}</p>
      {all.length === 0 ? <p>{text.none}</p> : <>
        <div className={styles.row} role="group" aria-label={text.statusFilter}>
          {(["OPEN", "DONE", "ALL"] as const).map(value => <Button key={value} variant="secondary" aria-pressed={status === value}
            onClick={() => setStatus(value)}>{text.statuses[value]}</Button>)}
        </div>
        {!mapMaker && <ol className={styles.choices} data-testid="map-errors-choices">
          {candidates.map(row => {
            const include = choice[row.note.id]?.include ?? row.near === undefined;
            return <li key={row.note.id} data-near={row.near !== undefined || undefined}>
              <label className={styles.check}><input type="checkbox" checked={include} onChange={event => set(row.note.id, { include: event.target.checked })} />
                {text.include}: <span className={styles.text}>{row.note.text}</span></label>
              {row.near !== undefined && <p className={styles.warning} role="alert">{text.near(row.near)}</p>}
              {row.note.photo && <label className={styles.check}><input type="checkbox" checked={withPhoto(row.note)}
                onChange={event => set(row.note.id, { photo: event.target.checked })} />{text.includePhoto}</label>}
            </li>;
          })}
        </ol>}
        {!mapMaker && <p className={styles.reminder} role="note">{text.textReminder}</p>}
        {candidates.some(row => row.note.photo) && <p className={styles.reminder}>{text.photoReminder}</p>}
        {!mapMaker && <p role="status">{text.selected(included.length, candidates.length)}</p>}
        {actionFailed && <Notice tone="error">{text.actionFailed}</Notice>}
        {!hasMap && <Notice tone="attention">{text.noMap}</Notice>}
        {mapState === "failed" && <Notice tone="attention">{text.mapFailed}</Notice>}
        <div className={styles.row}>
          <Button onClick={() => window.print()} disabled={included.length === 0}>{text.print}</Button>
          <Button variant="secondary" onClick={download} disabled={included.length === 0} data-testid="map-errors-geojson">{text.geojson}</Button>
        </div>
        <p className={styles.muted}>{crsText}</p>
        <h2>{text.preview}</h2>
      </>}
    </section>
    {included.length > 0 && <article className={styles.sheet} data-testid="map-errors-sheet" aria-label={text.preview}>
      <h1>{text.sheetTitle}</h1>
      {document && <p className={styles.muted}>{text.scale(document.event.mapScale)}</p>}
      {included.map((row, index) => <section key={row.note.id} className={styles.item}>
        <h2>{text.number(index + 1)}{row.note.status === "DONE" ? ` · ${text.statusDone}` : ""}</h2>
        {images[row.note.id] ? <img className={styles.crop} src={images[row.note.id]} alt={text.renderAlt(index + 1)}
          style={{ width: `${Math.round((row.crop.maxX - row.crop.minX) * ENLARGE)}mm` }} />
          : hasMap && mapState !== "failed" ? <p className={styles.muted} role="status">{text.loading}</p> : null}
        <p className={styles.text}>{row.note.text}</p>
        {mapMaker && <div className={styles.thread} data-testid="map-errors-thread">
          {row.note.replies.length > 0 && <ul>{row.note.replies.map(answer => <li key={answer.id}>{answer.text}</li>)}</ul>}
          <form className={styles.row} onSubmit={event => {
            event.preventDefault();
            const value = reply[row.note.id]?.trim();
            if (value) void act(async () => { await replyCourseSettingNote(raceId, row.note.id, value); setReply(current => ({ ...current, [row.note.id]: "" })); });
          }}>
            <label>{text.reply}<input type="text" maxLength={2000} value={reply[row.note.id] ?? ""}
              onChange={event => setReply(current => ({ ...current, [row.note.id]: event.target.value }))} /></label>
            <Button type="submit" variant="secondary" disabled={!reply[row.note.id]?.trim()}>{text.sendReply}</Button>
            <Button variant="secondary" onClick={() => void act(() => setCourseSettingNoteStatus(raceId, row.note.id, row.note.status === "OPEN" ? "DONE" : "OPEN"))}>
              {row.note.status === "OPEN" ? text.markDone : text.reopen}</Button>
          </form>
        </div>}
        {withPhoto(row.note) && <img className={styles.photo} src={courseSettingNotePhotoUrl(raceId, row.note.id)} alt={text.photoAlt(index + 1)} />}
      </section>)}
    </article>}
  </main>;
}
