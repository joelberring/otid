"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { trainingEn } from "../../i18n/course-setting-training-en";
import { useTexts } from "../language-provider";
import {
  trainingMapPasses, type CourseSettingDocument, type MapRect, type CourseSettingEdit, type OverprintTraining, type SymbolCatalogEntry, type TrainingMapPass
} from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { trainingSv } from "../../i18n/course-setting-training-sv";
import { ALL_CONTROLS } from "../../lib/course-setting-hit";
import type { MapRenderSession } from "../../lib/course-setting-map-protocol";
import { safely } from "../../lib/course-setting-safely";
import { changeCourseTraining, legAt, newTrainingId } from "../../lib/course-setting-training";
import { bingoAreaFrom, bingoGroups, setBingoAreaEdits, setGroupAreaEdits } from "../../lib/bingo-setup";
import { toScreen, type Viewport } from "../../lib/course-setting-viewport";
import { TrainingPanel } from "./course-setting-training";

/** Verktyget på kartan medan något ritas eller läggs (område, linje, sista säkra). */
export type TrainingTool = { readonly kind: "AREA" | "LINE"; readonly points: readonly Point[] } | { readonly kind: "ATTACK" }
  /** Bingons område: träningens, eller gruppens eget (`course`). */
  | { readonly kind: "BINGO"; readonly points: readonly Point[]; readonly course?: string | undefined };

/**
 * ADR-0192 beslut 8: träningsläget i editorn. Kartans pass (före och efter med "Visa träningen"), symbolerna ur kartans
 * Worker, verktygen på kartan och panelen. Ändringarna går som `PUT_TRAINING` genom editorns vanliga väg (ångra, samarbete).
 */
export function useCourseSettingTraining({ document, view, variant, session, mapReady, mapBounds, readOnly, onEdits, onView, say, bingoPhone }: {
  document: CourseSettingDocument; view: string; variant: string | undefined; session: MapRenderSession | undefined; mapReady: boolean;
  mapBounds: MapRect | undefined; onView: (course: string) => void; bingoPhone?: ReactNode;
  readOnly: boolean; onEdits: (edits: readonly CourseSettingEdit[]) => void;
  say: (message: { tone: "ok" | "error" | "attention"; text: string }) => void;
}) {
  const text = useTexts(trainingSv, trainingEn);
  const [show, setShow] = useState(true);
  const [tool, setTool] = useState<TrainingTool>();
  // Bingons område innan det finns en grupp (sedan står det i gruppernas träning).
  const [bingoArea, setBingoArea] = useState<MapRect>();
  const [symbols, setSymbols] = useState<readonly SymbolCatalogEntry[]>([]);
  useEffect(() => { if (session && mapReady) session.symbols(setSymbols); }, [session, mapReady]);
  useEffect(() => { setTool(undefined); }, [view]);

  const training = document.training;
  const passes = useMemo<readonly TrainingMapPass[] | undefined>(() => !show || !training ? undefined
    : safely("Träningen", () => trainingMapPasses(document, { course: view, variant }), () => undefined),
  // Passen beror på träningen, banans kontroller och sträckor.
  [show, training, document.controls, document.courseControls, document.legs, document.courses, view, variant]);
  // Editorn visar kontrollantens vy (kontrollerna syns också i linjeorienteringen); av = utan träningen.
  const overprint = useMemo<OverprintTraining>(() => show ? { view: "CONTROLLER" } : { off: true }, [show]);

  const finish = () => {
    if (!tool || tool.kind === "ATTACK") { setTool(undefined); return; }
    if (tool.kind === "AREA" && tool.points.length >= 3) {
      const id = newTrainingId();
      onEdits([{ type: "PUT_TRAINING", areas: { [id]: { id, polygon: tool.points, filter: { preset: "CONTOURS", groups: ["LANDFORM", "TECHNICAL", "FORBIDDEN"], hide: [], show: [] },
        courses: view === ALL_CONTROLS ? [] : [view] } } }]);
    }
    if (tool.kind === "BINGO") {
      const area = bingoAreaFrom(tool.points, mapBounds);
      const group = tool.course === undefined ? undefined : bingoGroups(document).find(row => row.course === tool.course);
      if (area && group) onEdits(setGroupAreaEdits(document, group, area, true));
      else if (area) { setBingoArea(area); const edits = setBingoAreaEdits(document, area); if (edits.length > 0) onEdits(edits); }
    }
    if (tool.kind === "LINE" && tool.points.length >= 2 && view !== ALL_CONTROLS) {
      onEdits([changeCourseTraining(document, view, current => ({ ...current, line: { points: tool.points } }))]);
    }
    setTool(undefined);
  };

  /** Ett klick på kartan medan ett verktyg är valt; sant = klicket är taget. */
  const tap = (point: Point, toleranceMm: number): boolean => {
    if (!tool || readOnly) return false;
    if (tool.kind === "ATTACK") {
      const leg = view === ALL_CONTROLS ? undefined : legAt(document, view, point, Math.max(toleranceMm * 2, 2));
      if (!leg) { say({ tone: "attention", text: text.attack.noLeg }); return true; }
      const id = newTrainingId();
      onEdits([{ type: "PUT_TRAINING", attackPoints: { [id]: { id, from: leg.from, to: leg.to, at: point } } }]);
      return true;
    }
    setTool({ ...tool, points: [...tool.points, point] });
    return true;
  };

  const draw = useCallback((ctx: CanvasRenderingContext2D, mapView: Viewport) => {
    if (!tool || tool.kind === "ATTACK" || tool.points.length === 0) return;
    const corners = tool.kind === "BINGO" && tool.points.length >= 2 ? bingoAreaFrom(tool.points, undefined) : undefined;
    const points = (corners ? [{ x: corners.minX, y: corners.minY }, { x: corners.maxX, y: corners.minY }, { x: corners.maxX, y: corners.maxY },
      { x: corners.minX, y: corners.maxY }] : tool.points).map(point => toScreen(mapView, point));
    ctx.save();
    ctx.strokeStyle = "#a626ff";
    ctx.fillStyle = "rgba(166, 38, 255, 0.12)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    if (tool.kind === "AREA" || corners) { ctx.closePath(); ctx.fill(); }
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of points) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fillStyle = "#a626ff"; ctx.fill(); }
    ctx.restore();
  }, [tool]);

  const panel: ReactNode = <TrainingPanel document={document} view={view} readOnly={readOnly} symbols={symbols} show={show} onShow={setShow}
    tool={tool} onTool={setTool} onFinish={finish} onEdits={onEdits} say={say} bingoArea={bingoArea} onView={onView}
    bingoPhone={bingoPhone} />;
  return { passes, overprint, tap, draw, panel, tool, drawing: tool !== undefined };
}
