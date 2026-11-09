"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clubArchiveEn } from "../../i18n/club-archive-en";
import { clubArchiveChecksEn } from "../../i18n/club-archive-more-en";
import { useTexts } from "../language-provider";
import type { ClubArchiveCourseFileView } from "@o-tid/contracts";
import { controlBounds, layoutOverprint, type CourseSettingDocument, type OverprintPrimitive } from "@o-tid/course-setting";
import { clubArchiveChecksSv } from "../../i18n/club-archive-checks-sv";
import { clubArchiveSv } from "../../i18n/club-archive-sv";
import { renderMapVersion } from "../../lib/club-archive-client";
import { renderFailureReason } from "../../lib/club-archive-thumbnails";
import { COURSE_PURPLE, drawOverprint } from "../../lib/course-setting-draw";
import { fitBounds, toScreen, type Bounds, type Viewport } from "../../lib/course-setting-viewport";
import type { MapFileRenderResult } from "../../lib/map-file-worker-protocol";
import styles from "./club-archive.module.css";


/** `reason` är skälet på svenska när kartan inte kunde ritas (ADR-0196), t.ex. "OCAD 7 stöds inte. …". */
export type RenderedVersion = { state: "loading" } | { state: "failed"; reason: string }
  | { state: "ready"; rendered: MapFileRenderResult; bitmap: ImageBitmap };

/** Kartversionen ritad i kartfilens Worker (en gång per version och sida). */
export function useRenderedVersion(clubId: string, version: { versionId: string; fileName: string } | null): RenderedVersion | null {
  const checksText = useTexts(clubArchiveChecksSv, clubArchiveChecksEn);
  const [result, setResult] = useState<RenderedVersion | null>(null);
  const versionId = version?.versionId, fileName = version?.fileName;
  useEffect(() => {
    if (!versionId || !fileName) { setResult(null); return; }
    const controller = new AbortController();
    setResult({ state: "loading" });
    void (async () => {
      try {
        const rendered = await renderMapVersion(clubId, versionId, fileName, () => undefined, controller.signal);
        if (controller.signal.aborted) return;
        if (rendered.type === "error") { setResult({ state: "failed", reason: renderFailureReason(rendered.code, rendered.message, checksText) }); return; }
        const bitmap = await createImageBitmap(rendered.png);
        if (!controller.signal.aborted) setResult({ state: "ready", rendered, bitmap });
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Kartan kunde inte ritas", error);
          setResult({ state: "failed", reason: renderFailureReason("FAILED", undefined, checksText) });
        }
      }
    })();
    return () => controller.abort();
  }, [clubId, versionId, fileName]);
  return result;
}

export type CourseData = NonNullable<ClubArchiveCourseFileView["courseData"]>[number];

/** CourseData: ringar, starttriangel, mål och linjer i banans färg (ingen banläggning finns att rita ur). */
function drawCourseData(ctx: CanvasRenderingContext2D, view: Viewport, course: CourseData, scale: number) {
  const mm = (value: number) => value * view.pxPerMm * 15000 / Math.max(scale, 1000) / 1.5;
  ctx.save();
  ctx.strokeStyle = COURSE_PURPLE;
  ctx.fillStyle = COURSE_PURPLE;
  ctx.lineWidth = Math.max(1.5, mm(0.35));
  const screen = course.points.map(point => ({ ...point, ...toScreen(view, point) }));
  for (let index = 1; index < screen.length; index++) {
    const a = screen[index - 1]!, b = screen[index]!;
    const angle = Math.atan2(b.y - a.y, b.x - a.x), radius = mm(3);
    ctx.beginPath();
    ctx.moveTo(a.x + Math.cos(angle) * radius, a.y + Math.sin(angle) * radius);
    ctx.lineTo(b.x - Math.cos(angle) * radius, b.y - Math.sin(angle) * radius);
    ctx.stroke();
  }
  ctx.font = `${Math.max(11, mm(4))}px Arial, sans-serif`;
  for (const point of screen) {
    ctx.beginPath();
    if (point.kind === "START") {
      const r = mm(3.5);
      ctx.moveTo(point.x, point.y - r); ctx.lineTo(point.x + r * 0.87, point.y + r / 2); ctx.lineTo(point.x - r * 0.87, point.y + r / 2); ctx.closePath();
      ctx.stroke();
      continue;
    }
    ctx.arc(point.x, point.y, mm(3), 0, Math.PI * 2);
    ctx.stroke();
    if (point.kind === "FINISH") { ctx.beginPath(); ctx.arc(point.x, point.y, mm(2.2), 0, Math.PI * 2); ctx.stroke(); continue; }
    ctx.fillText(point.label, point.x + mm(3.5), point.y - mm(3));
  }
  ctx.restore();
}

/**
 * Kartbilden med banan, inpassad på banan med 15 mm marginal (hela kartan utan bana). Används av förhandsvisningen och av
 * träningarnas bilder i arkivet (ADR-0196). `primitives` är banpåtrycket för .ppen, `courseData` ringarna för CourseData.
 */
export function paintCourseOnMap(ctx: CanvasRenderingContext2D, size: { width: number; height: number },
  version: { rendered: MapFileRenderResult; bitmap: ImageBitmap },
  course: { document?: CourseSettingDocument | undefined; primitives: readonly OverprintPrimitive[]; courseData?: CourseData | undefined }): void {
  const { rendered, bitmap } = version;
  const { document, primitives, courseData } = course;
  const map = rendered.metadata.bounds;
  const bounds: Bounds | null = document ? controlBounds(document)
    : courseData && courseData.points.length > 0 ? { minX: Math.min(...courseData.points.map(p => p.x)), minY: Math.min(...courseData.points.map(p => p.y)),
      maxX: Math.max(...courseData.points.map(p => p.x)), maxY: Math.max(...courseData.points.map(p => p.y)) } : null;
  const area = bounds ? { minX: bounds.minX - 15, minY: bounds.minY - 15, maxX: bounds.maxX + 15, maxY: bounds.maxY + 15 } : map;
  const view = fitBounds(area, size.width, size.height, 8);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size.width, size.height);
  const corner = toScreen(view, { x: rendered.metadata.render.originX, y: rendered.metadata.render.originY });
  const factor = view.pxPerMm / rendered.metadata.render.pxPerMm;
  ctx.drawImage(bitmap, corner.x, corner.y, bitmap.width * factor, bitmap.height * factor);
  if (primitives.length > 0) drawOverprint(ctx, view, primitives);
  if (courseData) drawCourseData(ctx, view, courseData, rendered.metadata.scale);
}

/**
 * ADR-0194: banan på kartan i arkivet och i "Använd igen". Kartan är ritad ur arkivets fil i webbläsaren och banan med
 * banläggningens banpåtryck (.ppen) eller som ringar och linjer (CourseData). Vyn visar banan med lite marginal.
 */
export function CoursePreview({ version, document, courseId, courseData, label }: {
  version: RenderedVersion | null;
  document?: CourseSettingDocument | undefined;
  courseId?: string | undefined;
  courseData?: CourseData | undefined;
  label: string;
}) {
  const text = useTexts(clubArchiveSv.entry, clubArchiveEn.entry);
  const clubArchiveChecksText = useTexts(clubArchiveChecksSv, clubArchiveChecksEn);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const primitives = useMemo(() => {
    if (!document || !courseId) return [];
    try { return layoutOverprint(document, { course: courseId }); } catch (error) { console.error("Banan kunde inte ritas", error); return []; }
  }, [document, courseId]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || version?.state !== "ready" || size.width === 0) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.round(size.width * ratio); element.height = Math.round(size.height * ratio);
    const ctx = element.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    paintCourseOnMap(ctx, size, version, { document, primitives, courseData });
  }, [version, size, primitives, courseData, document]);

  const status = !version ? text.previewNoMap : version.state === "loading" ? text.previewLoading : null;
  return <div className={styles.preview}>
    <canvas ref={canvas} role="img" aria-label={label} data-testid="course-preview" data-ready={version?.state === "ready" ? "true" : "false"} />
    {status && <p className={styles.previewStatus} role="status">{status}</p>}
    {version?.state === "failed" && <p className={styles.previewStatus} role="status" data-testid="preview-failed">
      {clubArchiveChecksText.previewFailed(version.reason)} {clubArchiveChecksText.previewDownload}</p>}
  </div>;
}
