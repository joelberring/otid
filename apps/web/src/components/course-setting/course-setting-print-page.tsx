"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  descriptionSymbols, layoutCoursePage, printVariants, type CoursePage, type CourseSettingDocument, type DescriptionSymbol, type MapRect
} from "@o-tid/course-setting";
import { coursePrintSv as text } from "../../i18n/course-setting-print-sv";
import { fetchCourseSetting } from "../../lib/course-setting-api";
import { symbolLookup } from "../../lib/course-setting-description-draw";
import { MapRenderSession } from "../../lib/course-setting-map-protocol";
import { mapRenderRequest, pageName, pageNodes, pageStyles, type PrintNode } from "../../lib/course-setting-print";
import { ALL_CONTROLS } from "../../lib/course-setting-hit";
import { controlledWorker } from "../../lib/course-setting-worker";
import { fetchMapSource } from "../../lib/route-choice-api";
import { Button, Notice } from "../ui";
import { DescriptionShapes } from "./description-svg";
import styles from "./course-setting-print-page.module.css";

// Steg 67: styrd av service workern när banläggningen är sparad för offline (`controlledWorker`).
const createMapWorker = () => controlledWorker(() => new Worker(new URL("../../lib/course-setting-map-worker.ts", import.meta.url), { type: "module" }));

interface Sheet { readonly key: string; readonly page: CoursePage }

/** Kartbilden som bild-URL (ritad av Workern med `drawMap`). */
async function renderMap(session: MapRenderSession, page: CoursePage): Promise<string> {
  const bitmap = await new Promise<ImageBitmap>(resolve => session.render(mapRenderRequest(page), (_id, image) => resolve(image)));
  const canvas = window.document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  return blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/png");
}

/**
 * Steg 64 (ADR-0180 beslut 11): `/admin/[raceId]/course-setting/print`. Sidorna ur `layoutCoursePage` för valda banor (och
 * varianter) med kartan ritad av Workern och banpåtrycket som SVG i papperets mm; webbläsarens utskrift ger ett utkast.
 * Färgerna är skärmens; PDF med dekorfärger för tryckeriet kommer i steg 65.
 */
export function CoursePrintPage({ raceId }: { raceId: string }) {
  const [document, setDocument] = useState<CourseSettingDocument | null>();
  const [mapBounds, setMapBounds] = useState<MapRect>();
  const [hasMap, setHasMap] = useState(false);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [eachVariant, setEachVariant] = useState(false);
  const [header, setHeader] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    try {
      const state = await fetchCourseSetting(raceId);
      const next = (state.setting?.document ?? null) as unknown as CourseSettingDocument | null;
      setDocument(next);
      setHasMap(state.mapFile !== null);
      if (state.mapFile?.bounds) setMapBounds(state.mapFile.bounds);
      const wanted = new URLSearchParams(window.location.search).get("course");
      if (next) setChosen(wanted && (wanted === ALL_CONTROLS || next.courses.some(course => course.id === wanted)) ? [wanted]
        : [...next.courses].sort((a, b) => a.order - b.order).map(course => course.id));
    } catch { setFailed(true); }
  }, [raceId]);
  useEffect(() => { void load(); }, [load]);

  // Kartfilen i en Worker; sidornas bilder ritas en i taget.
  const [session, setSession] = useState<MapRenderSession>();
  const [mapState, setMapState] = useState<"none" | "reading" | "ready" | "failed">("none");
  useEffect(() => {
    if (!hasMap) return;
    const controller = new AbortController();
    let created: MapRenderSession | undefined;
    setMapState("reading");
    void fetchMapSource(raceId, controller.signal).then(file => {
      created = new MapRenderSession(createMapWorker, bounds => { setMapBounds(current => current ?? bounds); setSession(created); setMapState("ready"); },
        () => setMapState("failed"));
      created.load(file.bytes, file.fileName);
    }, () => { if (!controller.signal.aborted) setMapState("failed"); });
    return () => { controller.abort(); created?.close(); };
  }, [raceId, hasMap]);

  const standard = document?.event.descriptionStandard ?? "2018";
  const symbols = useMemo(() => {
    try { return symbolLookup(descriptionSymbols(standard)); } catch (error) { console.error("Symbolerna misslyckades", error); return symbolLookup([] as DescriptionSymbol[]); }
  }, [standard]);
  const courses = useMemo(() => [...(document?.courses ?? [])].sort((a, b) => a.order - b.order), [document]);
  const { sheets, errors } = useMemo(() => {
    const out: Sheet[] = [], bad: string[] = [];
    if (!document) return { sheets: out, errors: bad };
    for (const course of [ALL_CONTROLS, ...courses.map(item => item.id)].filter(id => chosen.includes(id))) {
      try {
        for (const variant of printVariants(document, course, eachVariant)) {
          for (const page of layoutCoursePage(document, { course, ...(variant ? { variant } : {}), mapBounds, header })) {
            out.push({ key: `${course}|${variant}|${page.sheet}`, page });
          }
        }
      } catch (error) {
        console.error("Utskriftslayouten misslyckades", error);
        bad.push(course === ALL_CONTROLS ? text.print.allControls : courses.find(item => item.id === course)?.name ?? course);
      }
    }
    return { sheets: out, errors: bad };
  }, [document, courses, chosen, eachVariant, header, mapBounds]);

  // Kartbilderna per utsnitt (samma utsnitt och skala ritas en gång).
  const [images, setImages] = useState<Readonly<Record<string, string>>>({});
  const urls = useRef<string[]>([]);
  const started = useRef(new Set<string>());
  const imageKey = (page: CoursePage) => `${page.mapArea.minX.toFixed(3)},${page.mapArea.maxY.toFixed(3)},${page.clip.width.toFixed(2)},${page.clip.height.toFixed(2)},${page.transform.scale.toFixed(6)}`;
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void (async () => {
      for (const sheet of sheets) {
        const key = imageKey(sheet.page);
        if (cancelled) return;
        if (started.current.has(key)) continue;
        started.current.add(key);
        try {
          const url = await renderMap(session, sheet.page);
          urls.current.push(url);
          if (!cancelled) setImages(current => ({ ...current, [key]: url }));
        } catch (error) { started.current.delete(key); console.error("Kartan kunde inte ritas", error); }
      }
    })();
    return () => { cancelled = true; };
  }, [session, sheets]);
  useEffect(() => () => { for (const url of urls.current) if (url.startsWith("blob:")) URL.revokeObjectURL(url); }, []);

  const toggle = (id: string, on: boolean) => setChosen(current => on ? [...current, id] : current.filter(item => item !== id));
  const allIds = [ALL_CONTROLS, ...courses.map(course => course.id)];
  const back = <Link className={styles.back} href={`/admin/${raceId}/course-setting`}>{text.page.back}</Link>;
  if (failed) return <main className={styles.page}><div className={styles.controls}>{back}<Notice tone="error" role="alert"><p>{text.page.failed}</p>
    <div><Button variant="secondary" onClick={() => void load()}>{text.page.retry}</Button></div></Notice></div></main>;
  if (document === undefined) return <main className={styles.page}><div className={styles.controls}>{back}<p role="status">{text.page.loading}</p></div></main>;
  if (document === null) return <main className={styles.page}><div className={styles.controls}>{back}<p>{text.page.noSetting}</p></div></main>;
  const waiting = mapState === "reading" || (mapState === "ready" && sheets.some(sheet => !images[imageKey(sheet.page)]));
  return <main className={styles.page}>
    <style>{pageStyles(sheets.map(sheet => sheet.page))}</style>
    <div className={styles.controls}>
      {back}
      <h1>{text.page.title}</h1>
      <Notice tone="attention"><p data-testid="print-draft">{text.page.draft}</p></Notice>
      <fieldset className={styles.courses}>
        <legend>{text.page.courses}</legend>
        <label><input type="checkbox" checked={allIds.every(id => chosen.includes(id))} onChange={event => setChosen(event.target.checked ? allIds : [])} />{text.page.all}</label>
        <label><input type="checkbox" checked={chosen.includes(ALL_CONTROLS)} onChange={event => toggle(ALL_CONTROLS, event.target.checked)} />{text.print.allControls}</label>
        {courses.map(course => <label key={course.id}><input type="checkbox" checked={chosen.includes(course.id)}
          onChange={event => toggle(course.id, event.target.checked)} />{course.name}</label>)}
      </fieldset>
      <div className={styles.row}>
        <label className={styles.check}><input type="checkbox" checked={eachVariant} onChange={event => setEachVariant(event.target.checked)} />{text.page.eachVariant}</label>
        <label className={styles.check}><input type="checkbox" checked={header} onChange={event => setHeader(event.target.checked)} />{text.page.header}</label>
      </div>
      <div className={styles.row}>
        <Button onClick={() => window.print()} disabled={sheets.length === 0}>{text.page.print}</Button>
        <span role="status">{sheets.length === 0 ? text.page.none : text.page.pages(sheets.length)}{waiting ? ` – ${text.page.readingMap}` : ""}</span>
      </div>
      {!hasMap && <p className={styles.muted}>{text.page.noMap}</p>}
      {mapState === "failed" && <Notice tone="attention">{text.page.mapFailed}</Notice>}
      {errors.map(name => <Notice key={name} tone="error">{text.page.failedCourse(name)}</Notice>)}
    </div>
    <div className={styles.sheets}>
      {sheets.map(sheet => <PrintSheet key={sheet.key} page={sheet.page} nodes={pageNodes(sheet.page, symbols)} image={images[imageKey(sheet.page)]} />)}
    </div>
  </main>;
}

function PrintSheet({ page, nodes, image }: { page: CoursePage; nodes: readonly PrintNode[]; image: string | undefined }) {
  const clipId = `clip-${pageName(page)}-${page.course}-${page.variant ?? ""}-${page.sheet}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const { paper, clip } = page;
  return <svg className={styles.sheet} role="img" aria-label={text.page.sheet(page.title, page.sheet, page.sheets)} data-testid="print-sheet"
    data-course={page.course} data-variant={page.variant ?? ""} data-map={image ? "ready" : "waiting"} data-scale={page.printScale}
    width={`${paper.widthMm}mm`} height={`${paper.heightMm}mm`} viewBox={`0 0 ${paper.widthMm} ${paper.heightMm}`} style={{ page: pageName(page) }}>
    <defs><clipPath id={clipId}><rect x={clip.x} y={clip.y} width={clip.width} height={clip.height} /></clipPath></defs>
    <rect width={paper.widthMm} height={paper.heightMm} fill="#fff" />
    {image && <image href={image} x={clip.x} y={clip.y} width={clip.width} height={clip.height} preserveAspectRatio="none" data-testid="print-map" />}
    <g clipPath={`url(#${clipId})`} data-testid="print-overprint">{nodes.map((node, index) => <Node key={index} node={node} />)}</g>
    {page.texts.map((item, index) => <text key={index} x={item.at.x} y={item.at.y} fontSize={item.heightMm} fontWeight={item.bold ? "bold" : undefined}
      fill={item.color === "COURSE" ? "rgb(204, 0, 255)" : "#000"} fontFamily="Arial, Helvetica, sans-serif">{item.text}</text>)}
    <text x={Math.max(2, paper.marginMm)} y={paper.heightMm - Math.max(1.2, paper.marginMm / 3)} fontSize={2} fill="#777"
      fontFamily="Arial, Helvetica, sans-serif">{text.page.draft}</text>
  </svg>;
}

function Node({ node }: { node: PrintNode }) {
  switch (node.tag) {
    case "path": return <path d={node.d} fill={node.fill ?? "none"} fillRule="evenodd" stroke={node.stroke} strokeWidth={node.width} strokeDasharray={node.dash}
      strokeLinecap={node.cap} strokeLinejoin="round" opacity={node.opacity} data-ref={node.ref} data-role={node.role} />;
    case "text": return <text x={node.x} y={node.y} fontSize={node.size} fill={node.fill} textAnchor={node.anchor} dominantBaseline="middle"
      fontFamily={node.family} fontWeight={node.bold ? "bold" : undefined} fontStyle={node.italic ? "italic" : undefined} data-ref={node.ref} data-role={node.role}>{node.text}</text>;
    case "image": return <image href={node.href} x={node.x} y={node.y} width={node.width} height={node.height} preserveAspectRatio="none" data-ref={node.ref} />;
    case "description": return <g transform={`translate(${node.x} ${node.y}) scale(${node.scale})`} data-ref={node.ref} data-role="SPECIAL" data-testid="print-description">
      <DescriptionShapes nodes={node.nodes} /></g>;
  }
}
