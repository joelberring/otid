"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  courseControlIds, findPrintLayout, paperAnchorOf, layoutAdjustments, layoutDocument, MAIN_LAYOUT, printAreaOf, printSheetGroups, type CourseSettingDocument,
  type CourseSettingEdit, type MapRect, type PaperRect, type Sheet, type SheetDescription, type SheetFrame
} from "@o-tid/course-setting";
import { layoutSv as text } from "../../i18n/course-setting-layout-sv";
import { sheetEdits, scaleText } from "../../lib/course-setting-layouts";
import { mapRenderRequest } from "../../lib/course-setting-print";
import type { MapRenderSession } from "../../lib/course-setting-map-protocol";
import type { SymbolLookup } from "../../lib/course-setting-description-draw";
import { movedFrameArea, pageOfSheet, printAreaEdit, resizedFrameArea } from "../../lib/course-setting-sheet-frame";
import { Button } from "../ui";
import { frameImageKey, SheetView } from "./course-setting-sheet";
import { SheetPaperPanel, type SheetTarget } from "./course-setting-sheet-paper";
import { PaperSpacePanel } from "./course-setting-paper-space";
import { paperDescriptionEdit, PaperDescriptionsPanel, paperCourses } from "./course-setting-paper-panel";
import type { FrameChange } from "./course-setting-paper-items";
import { usePaperSpace } from "./use-paper-space";
import { useDetailGaps } from "./course-setting-circle-cutting";
import styles from "./course-setting-layout.module.css";

/** En kartbild per ram (samma utsnitt ritas en gång), utan färgprofil: Layout handlar om papperet. */
export function useFrameImages(session: MapRenderSession | undefined, sheets: readonly Sheet[]): Readonly<Record<string, string>> {
  const [images, setImages] = useState<Readonly<Record<string, string>>>({});
  const started = useRef(new Set<string>());
  const urls = useRef<string[]>([]);
  useEffect(() => {
    if (!session) return;
    for (const sheet of sheets) for (const frame of sheet.frames) {
      const key = frameImageKey(frame, "");
      if (started.current.has(key)) continue;
      started.current.add(key);
      session.render(mapRenderRequest(frame, 150), (_id, bitmap) => {
        const canvas = window.document.createElement("canvas");
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
        bitmap.close();
        canvas.toBlob(blob => {
          const url = blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/png");
          urls.current.push(url);
          setImages(current => ({ ...current, [key]: url }));
        }, "image/png");
      });
    }
  }, [session, sheets]);
  useEffect(() => () => { for (const url of urls.current) if (url.startsWith("blob:")) URL.revokeObjectURL(url); }, []);
  return images;
}

/**
 * ADR-0217 beslut 3–4: arket (bana × layout) öppnat. Papperets element, klippningen, utsnittet och kartbytets delar redigeras
 * som på utskriftssidan, men på dokumentet som utskriften ser det för layouten (`layoutDocument`); ändringarna sparas på
 * arket (`sheetEdits`). "Justera för 1:7 500": dra ett nummer på arket (bara i layouten) och ringavbrotten per kontroll.
 */
export function LayoutSheetEditor({ raceId, document, layout, course, canEdit, save, session, mapBounds, symbols, onClose }: {
  raceId: string; document: CourseSettingDocument; layout: string; course: string; canEdit: boolean;
  save: (edits: CourseSettingEdit[]) => Promise<boolean>; session: MapRenderSession | undefined; mapBounds: MapRect | undefined;
  symbols: SymbolLookup; onClose: () => void;
}) {
  const projected = useMemo(() => layoutDocument(document, layout), [document, layout]);
  const sheetSave = useMemo(() => (edits: CourseSettingEdit[]) => save(sheetEdits(document, layout, edits)), [save, document, layout]);
  const chosen = useMemo(() => [course], [course]);
  const paperSpace = usePaperSpace({ raceId, document: projected, save: sheetSave, canEdit, chosen });
  const view = paperSpace.view ?? projected;
  const aids = useDetailGaps(session, view).options;
  const sheets = useMemo(() => {
    try {
      return printSheetGroups(view, { kind: "COURSE" }, [{ course }], { mapBounds, ...aids }).flatMap(group => group.sheets);
    } catch (error) { console.error("Arket kunde inte läggas ut", error); return []; }
  }, [view, course, mapBounds, aids]);
  const images = useFrameImages(session, sheets);
  const [frameEditing, setFrameEditing] = useState(false);
  const panel = paperSpace.panel(sheets.map(sheet => ({ sheet })));
  const layoutName = layout === MAIN_LAYOUT ? document.event.mainLayout?.name ?? text.mainName : findPrintLayout(document, layout)?.name ?? layout;
  const courseName = course === "ALL_CONTROLS" ? text.overview.allControls : document.courses.find(row => row.id === course)?.name ?? course;
  const first = sheets[0];
  const target: SheetTarget | undefined = first?.frames[0] ? { course, part: first.frames[0].part, label: `${courseName} – ${layoutName}`, sheet: first } : undefined;
  const onFrame = (sheet: Sheet, frame: SheetFrame, change: FrameChange) => {
    const area = printAreaOf(view, frame.course, frame.part);
    const page = pageOfSheet(area, sheet);
    const next = change.kind === "MOVE" ? movedFrameArea(area, page, frame, change.dx, change.dy) : resizedFrameArea(area, page, frame, sheet, change.width, change.height);
    void panel?.onSave([printAreaEdit(frame.course, frame.part, next)]);
  };
  const interaction = frameEditing && canEdit && target ? { ...paperSpace.interaction, frame: { course: target.course, part: target.part }, onFrame }
    : paperSpace.interaction;
  const placed = useMemo(() => {
    const out = new Map<string, SheetDescription>();
    for (const sheet of sheets) for (const item of sheet.descriptions) if (item.course && !out.has(item.course)) out.set(item.course, item);
    return out;
  }, [sheets]);
  const placeDescription = (item: SheetDescription, frame: SheetFrame, rect: PaperRect, boxMm: number) => {
    if (!item.course) return;
    const settings = view.event.paperLayouts?.[item.course]?.descriptions ?? {};
    void paperSpace.panel(sheets.map(sheet => ({ sheet })))?.onSave([paperDescriptionEdit(view, item.course, { ...settings, show: true,
      at: paperAnchorOf(rect, frame.clip), boxMm: Math.max(3, Math.min(10, boxMm)) })]);
  };
  const adjust = layout !== MAIN_LAYOUT && course !== "ALL_CONTROLS";
  const scale = first?.frames[0]?.printScale;
  return <section className={styles.panel} aria-labelledby="layout-sheet" data-testid="layout-sheet" data-layout={layout} data-course={course}>
    <div className={styles.headRow}>
      <h2 id="layout-sheet">{text.sheet.heading(courseName, layoutName)}</h2>
      <Button variant="quiet" onClick={onClose}>{text.sheet.close}</Button>
    </div>
    <div className={styles.sheetBody}>
      <div className={styles.sheetSlot}>
        {sheets.map((sheet, index) => <div key={index} className={styles.sheetWrap}>
          <SheetView sheet={sheet} index={2000 + index} symbols={symbols} images={images} colorsKey="" label={target?.label ?? courseName}
            onPlace={canEdit ? placeDescription : undefined} paper={interaction} testId="layout-sheet-view" />
          {adjust && canEdit && <NumberLayer sheet={sheet} onMove={(courseControl, at) => void save([{ type: "MOVE_NUMBER", course, courseControl, at, printLayout: layout }])} />}
        </div>)}
      </div>
      <div className={styles.sheetPanels}>
        <AdjustPanel document={document} layout={layout} course={course} scale={scale} canEdit={canEdit} save={save} />
        {target && <SheetPaperPanel raceId={raceId} document={view} target={target} readOnly={!canEdit} onSave={edits => panel ? panel.onSave(edits) : Promise.resolve(false)}
          frameEditing={frameEditing} onFrameEditing={setFrameEditing} />}
        {panel && <PaperSpacePanel raceId={raceId} document={view} readOnly={!canEdit} {...panel} />}
        <PaperDescriptionsPanel document={view} courses={paperCourses(view, chosen)} placed={placed} readOnly={!canEdit}
          onSave={edits => panel ? panel.onSave(edits) : Promise.resolve(false)} />
      </div>
    </div>
  </section>;
}

/** Numren på arket som går att dra (bara i en annan layout än huvudlayouten): släppt läge = justerat nummer i kartans mm. */
function NumberLayer({ sheet, onMove }: { sheet: Sheet; onMove: (courseControl: string, at: { x: number; y: number }) => void }) {
  const [drag, setDrag] = useState<{ ref: string; dx: number; dy: number }>();
  const start = useRef<{ x: number; y: number; ref: string }>(undefined);
  const point = (event: PointerEvent<SVGElement>) => {
    const matrix = event.currentTarget.ownerSVGElement?.getScreenCTM()?.inverse();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix) : { x: 0, y: 0 };
  };
  const numbers = sheet.frames.flatMap(frame => frame.figures.flatMap(figure => figure.kind === "text" && figure.role === "NUMBER" && figure.ref
    ? [{ frame, figure }] : []));
  return <svg className={styles.numberLayer} viewBox={`0 0 ${sheet.paper.widthMm} ${sheet.paper.heightMm}`} data-testid="layout-number-layer">
    {numbers.map(({ frame, figure }) => {
      const s = frame.transform.scale;
      const x = s * figure.at.x + frame.transform.translateX, y = -s * figure.at.y + frame.transform.translateY;
      const h = figure.heightMm * s, w = Math.max(h, figure.text.length * h * 0.62);
      const moving = drag?.ref === figure.ref ? drag : undefined;
      return <rect key={figure.ref} x={x - w / 2 + (moving?.dx ?? 0)} y={y - h / 2 + (moving?.dy ?? 0)} width={w} height={h} fill="rgba(29, 111, 209, .12)"
        stroke="#1d6fd1" strokeWidth={0.2} strokeDasharray="0.8 0.5" style={{ cursor: "grab", touchAction: "none" }} data-testid="layout-number" data-ref={figure.ref}
        aria-label={text.sheet.numberLabel(figure.text)}
        onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); const at = point(event);
          start.current = { x: at.x, y: at.y, ref: figure.ref! }; setDrag({ ref: figure.ref!, dx: 0, dy: 0 }); }}
        onPointerMove={event => { const from = start.current; if (!from) return; const at = point(event); setDrag({ ref: from.ref, dx: at.x - from.x, dy: at.y - from.y }); }}
        onPointerUp={() => {
          const current = drag;
          start.current = undefined; setDrag(undefined);
          if (current && (Math.abs(current.dx) > 0.2 || Math.abs(current.dy) > 0.2)) {
            onMove(current.ref, { x: Math.round((figure.at.x + current.dx / s) * 100) / 100, y: Math.round((figure.at.y - current.dy / s) * 100) / 100 });
          }
        }} />;
    })}
  </svg>;
}

/** "Justera för 1:7 500": antalet justeringar, ringavbrotten per kontroll och "Ta bort justeringar". */
function AdjustPanel({ document, layout, course, scale, canEdit, save }: { document: CourseSettingDocument; layout: string; course: string;
  scale: number | undefined; canEdit: boolean; save: (edits: CourseSettingEdit[]) => Promise<boolean> }) {
  const found = findPrintLayout(document, layout);
  if (layout === MAIN_LAYOUT || course === "ALL_CONTROLS" || !found) {
    return <section className={styles.panel} data-testid="layout-adjust"><h3>{text.sheet.adjust(scale ? scaleText(scale) : "")}</h3>
      <p className={styles.muted}>{text.sheet.adjustMain}</p></section>;
  }
  const adjustments = layoutAdjustments(document, layout, course);
  const count = adjustments.numbers.length + adjustments.circleGaps.length;
  const ids = courseControlIds(document, course);
  const controls = [...new Set([...ids].map(id => document.courseControls[id]!.control))].map(id => document.controls[id]!)
    .filter(control => control.kind === "NORMAL" || control.kind === "FINISH").sort((a, b) => Number(a.code ?? 999) - Number(b.code ?? 999));
  const numbers = adjustments.numbers;
  return <section className={styles.panel} aria-labelledby="layout-adjust" data-testid="layout-adjust" data-count={count}>
    <h3 id="layout-adjust">{text.sheet.adjust(scaleText(found.scale))}</h3>
    <p className={styles.muted}>{text.sheet.adjustHelp}</p>
    <p data-testid="layout-adjust-count">{text.sheet.adjustments(count)}</p>
    {numbers.length > 0 && <ul className={styles.list}>{numbers.map(cc => {
      const code = document.controls[document.courseControls[cc]!.control]?.code ?? cc;
      return <li key={cc}>{text.sheet.numberLabel(code)} <Button variant="quiet" disabled={!canEdit}
        onClick={() => void save([{ type: "MOVE_NUMBER", course, courseControl: cc, at: null, printLayout: layout }])}>{text.sheet.numberReset}</Button></li>;
    })}</ul>}
    <details>
      <summary>{text.sheet.gaps}</summary>
      <div className={styles.stack}>{controls.map(control => <GapRow key={control.id} code={control.code ?? control.id} value={found.circleGaps?.[control.id]}
        disabled={!canEdit} onSave={gaps => void save([{ type: "SET_LAYOUT_CIRCLE_GAPS", layout, control: control.id, gaps }])} />)}</div>
    </details>
    {count > 0 && <div><Button variant="secondary" disabled={!canEdit} data-testid="layout-adjust-clear"
      onClick={() => void save([{ type: "CLEAR_LAYOUT_ADJUSTMENTS", layout, course }])}>{text.sheet.clear}</Button></div>}
  </section>;
}

function GapRow({ code, value, disabled, onSave }: { code: string; value: readonly { startDegrees: number; endDegrees: number }[] | undefined; disabled: boolean;
  onSave: (gaps: { startDegrees: number; endDegrees: number }[] | null) => void }) {
  const shown = value ? value.map(arc => `${arc.startDegrees}-${arc.endDegrees}`).join(", ") : "";
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const parsed = draft.trim() === "" ? [] : draft.split(",").map(part => part.trim().split("-").map(Number));
  const valid = parsed.every(pair => pair.length === 2 && pair.every(Number.isFinite));
  return <div className={styles.row}>
    <label className={styles.field}>{code}<input value={draft} disabled={disabled} placeholder={text.sheet.gapsFollow} data-testid={`layout-gaps-${code}`}
      onChange={event => setDraft(event.target.value)} /></label>
    <Button variant="secondary" disabled={disabled || !valid || draft === shown}
      onClick={() => onSave(parsed.map(([start, end]) => ({ startDegrees: start!, endDegrees: end! })))}>{text.sheet.gapsSave}</Button>
    {value && <Button variant="quiet" disabled={disabled} onClick={() => onSave(null)}>{text.sheet.gapsReset}</Button>}
  </div>;
}
