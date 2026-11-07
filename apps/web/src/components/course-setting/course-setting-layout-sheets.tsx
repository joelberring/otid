"use client";

import { useEffect, useMemo, useState } from "react";
import {
  expandPartItems, layoutDocument, sheetLayoutOfLayout, MAIN_LAYOUT, paperAnchorOf, printAreaOf, printSheetGroups, runnerBackSheet, RUNNER_BACK,
  type CourseSettingDocument, type CourseSettingEdit, type SheetLayout, type MapRect, type PaperRect, type PaperTemplate, type Sheet,
  type SheetDescription, type SheetFrame, type SheetItem
} from "@o-tid/course-setting";
import { coursePrintSv as printText } from "../../i18n/course-setting-print-sv";
import { printOutputSv as outputText } from "../../i18n/course-setting-print-overview-sv";
import { runnerPrintSv as runnerText } from "../../i18n/course-setting-runner-print-sv";
import { layoutSv as text } from "../../i18n/course-setting-layout-sv";
import { sheetEdits } from "../../lib/course-setting-layouts";
import { pageStyles } from "../../lib/course-setting-print";
import { sheetCards, type SheetCard } from "../../lib/course-setting-print-overview";
import { templateEdits } from "../../lib/course-setting-paper";
import type { SymbolLookup } from "../../lib/course-setting-description-draw";
import { movedFrameArea, pageOfSheet, printAreaEdit, resizedFrameArea } from "../../lib/course-setting-sheet-frame";
import { ALL_CONTROLS } from "../../lib/course-setting-hit";
import { safely } from "../../lib/course-setting-safely";
import { SheetView } from "./course-setting-sheet";
import { SheetPaperPanel, type SheetTarget } from "./course-setting-sheet-paper";
import { PaperSpacePanel } from "./course-setting-paper-space";
import { paperCourses, paperDescriptionEdit, PaperDescriptionsPanel } from "./course-setting-paper-panel";
import { SheetLayoutPanel } from "./course-setting-sheet-layout";
import { PrintOverview } from "./course-setting-print-overview";
import type { FrameChange } from "./course-setting-paper-items";
import { usePaperSpace } from "./use-paper-space";
import { useDetailGaps } from "./course-setting-circle-cutting";
import { AdjustPanel } from "./course-setting-layout-adjust";
import { NumberLayer } from "./course-setting-layout-numbers";
import { usePrintColors, useSheetImages, type PrintMap } from "./use-print-map";
import printStyles from "./course-setting-print-page.module.css";
import styles from "./course-setting-layout.module.css";

interface Shown { readonly key: string; readonly sheet: Sheet; readonly label: string }

/**
 * ADR-0217 (fas 3): arken i en layout, med all redigering av papperet som förut fanns på utskriftssidan. Banorna att visa (Alla,
 * Alla kontroller, banorna och baksidan per löpare), översikten med ett kort per ark och "Använd mallen", arken med papperets
 * element direkt på arket, och panelerna Papper och kartram, Kartor per ark, Papperet och Kontrollbeskrivningen. Allt räknas
 * på dokumentet som utskriften ser det för layouten (`layoutDocument`) och sparas på arket (`sheetEdits`); huvudlayouten är
 * banornas egna fält som förut.
 */
export function LayoutSheets({ raceId, document, layout, focus, canEdit, save, map, mapBounds, symbols, onClose, layoutName }: {
  raceId: string; document: CourseSettingDocument; layout: string; focus: string; canEdit: boolean;
  save: (edits: CourseSettingEdit[]) => Promise<boolean>; map: PrintMap; mapBounds: MapRect | undefined; symbols: SymbolLookup; onClose: () => void;
  layoutName: string;
}) {
  const projected = useMemo(() => layoutDocument(document, layout), [document, layout]);
  const sheetSave = useMemo(() => (edits: CourseSettingEdit[]) => save(sheetEdits(document, layout, edits)), [save, document, layout]);
  const [chosen, setChosen] = useState<readonly string[]>([focus]);
  const [back, setBack] = useState(false);
  const extra = useMemo(() => back ? [{ id: RUNNER_BACK, name: runnerText.backCourse }] : [], [back]);
  const paperSpace = usePaperSpace({ raceId, document: projected, save: sheetSave, canEdit, chosen, extra });
  const view = paperSpace.view ?? projected;
  const aids = useDetailGaps(map.session, view).options;
  const colors = usePrintColors(view, undefined, map);
  const [draft, setDraft] = useState<SheetLayout>();
  const template = draft ?? sheetLayoutOfLayout(document, layout);
  const courses = useMemo(() => [...view.courses].sort((a, b) => a.order - b.order), [view]);

  // Arken: de valda banorna (med kartbytenas delar) och, med baksidan vald, baksidan efter första arket.
  const sheets = useMemo<Shown[]>(() => {
    const items: SheetItem[] = safely("Banans delar", () => expandPartItems(view, [ALL_CONTROLS, ...courses.map(row => row.id)]
      .filter(id => chosen.includes(id)).map(course => ({ course }))), () => []);
    const out: Shown[] = [];
    const groups = printSheetGroups(view, template ? { kind: "TEMPLATE", template, fill: "FILL" } : { kind: "COURSE" }, items,
      { mapBounds, ...aids, runnerPlaceholders: true, onError: ({ error }) => console.error("Arket kunde inte läggas ut", error) });
    for (const group of groups) {
      const row = group.item === undefined ? undefined : items[group.item];
      group.sheets.forEach((sheet, index) => {
        const page = group.pages?.[index];
        out.push(page && row ? { key: `${row.course}|${row.part ?? ""}|${page.sheet}`, sheet, label: printText.page.sheet(page.title, page.sheet, page.sheets) }
          : { key: `t${group.item ?? ""}|${index}`, sheet, label: sheet.frames.map(frame => frame.title).join(", ") });
      });
    }
    const first = out[0]?.sheet;
    if (back && first?.frames[0]) out.push({ key: "back", sheet: { ...runnerBackSheet(view, first.paper, first.frames[0], { runnerPlaceholders: true }), back: true },
      label: runnerText.backCourse });
    return out;
  }, [view, courses, chosen, template, mapBounds, aids, back]);
  const images = useSheetImages(map, sheets, colors);

  const [openKey, setOpenKey] = useState<string>();
  const [frameEditing, setFrameEditing] = useState(false);
  const [printOnly, setPrintOnly] = useState<ReadonlySet<string>>();
  useEffect(() => {
    if (!printOnly) return;
    const done = () => setPrintOnly(undefined);
    window.addEventListener("afterprint", done, { once: true });
    const timer = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(timer); window.removeEventListener("afterprint", done); };
  }, [printOnly]);
  const panel = paperSpace.panel(sheets);
  // Överblickens ruta öppnar en bana: den visas och dess första ark blir det som redigeras.
  useEffect(() => {
    setChosen(current => current.includes(focus) ? current : [...current, focus]);
    panel?.onCourse(focus);
    setOpenKey(sheets.find(item => item.sheet.frames[0]?.course === focus)?.key);
    // Bara när banan som öppnas byts (arken och panelen följer därefter användarens val).
  }, [focus]);

  const placed = useMemo(() => {
    const out = new Map<string, SheetDescription>();
    for (const { sheet } of sheets) for (const item of sheet.descriptions) if (item.course && !out.has(item.course)) out.set(item.course, item);
    return out;
  }, [sheets]);
  const placeDescription = (item: SheetDescription, frame: SheetFrame, rect: PaperRect, boxMm: number) => {
    if (!item.course) return;
    const settings = view.event.paperLayouts?.[item.course]?.descriptions ?? {};
    void sheetSave([paperDescriptionEdit(view, item.course, { ...settings, show: true, at: paperAnchorOf(rect, frame.clip), boxMm: Math.max(3, Math.min(10, boxMm)) })]);
  };
  const editing = !template && panel;
  const open = sheets.find(item => item.key === openKey);
  const targetSlot = !editing ? undefined : open && open.sheet.frames[0]?.course === panel.course ? open
    : sheets.find(item => item.sheet.frames[0]?.course === panel.course);
  const target: SheetTarget | undefined = targetSlot?.sheet.frames[0]
    ? { course: targetSlot.sheet.frames[0].course, part: targetSlot.sheet.frames[0].part, label: targetSlot.label, sheet: targetSlot.sheet } : undefined;
  const onFrame = (sheet: Sheet, frame: SheetFrame, change: FrameChange) => {
    if (!panel) return;
    const area = printAreaOf(view, frame.course, frame.part);
    const page = pageOfSheet(area, sheet);
    const next = change.kind === "MOVE" ? movedFrameArea(area, page, frame, change.dx, change.dy) : resizedFrameArea(area, page, frame, sheet, change.width, change.height);
    void panel.onSave([printAreaEdit(frame.course, frame.part, next)]);
  };
  const interaction = editing && frameEditing && target && canEdit ? { ...paperSpace.interaction, frame: { course: target.course, part: target.part }, onFrame }
    : paperSpace.interaction;
  const cards = sheetCards(view, sheets, template?.name);
  const openCard = (card: SheetCard) => {
    setOpenKey(card.key);
    if (card.course && card.course !== ALL_CONTROLS) panel?.onCourse(card.course);
    window.document.getElementById(`print-sheet-${card.index}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const applyTemplate = (chosenTemplate: PaperTemplate, list: readonly string[] | "ALL") => {
    const ids = list === "ALL" ? courses.map(course => course.id) : list;
    void sheetSave(ids.flatMap(id => templateEdits(view, id, chosenTemplate)));
  };
  const choosePaperCourse = (id: string) => {
    panel?.onCourse(id);
    if (id !== RUNNER_BACK && !chosen.includes(id)) setChosen([...chosen, id]);
    setOpenKey(sheets.find(item => item.sheet.frames[0]?.course === id)?.key);
  };
  const allIds = [ALL_CONTROLS, ...courses.map(course => course.id)];
  const toggle = (id: string, on: boolean) => setChosen(current => on ? [...current, id] : current.filter(item => item !== id));
  const adjustable = layout !== MAIN_LAYOUT;
  return <section className={styles.panelWide} aria-labelledby="layout-sheets" data-testid="layout-sheet" data-layout={layout} data-course={focus}>
    <style>{pageStyles(sheets.map(item => item.sheet))}</style>
    <div className={styles.headRow}>
      <h2 id="layout-sheets">{text.sheet.heading(layoutName)}</h2>
      <button type="button" className={printStyles.linkButton} onClick={onClose}>{text.sheet.close}</button>
    </div>
    <fieldset className={printStyles.courses} data-testid="layout-courses">
      <legend>{printText.page.courses}</legend>
      <label><input type="checkbox" checked={allIds.every(id => chosen.includes(id))} onChange={event => setChosen(event.target.checked ? allIds : [focus])} />{printText.page.all}</label>
      <label><input type="checkbox" checked={chosen.includes(ALL_CONTROLS)} onChange={event => toggle(ALL_CONTROLS, event.target.checked)} />{printText.print.allControls}</label>
      {courses.map(course => <label key={course.id}><input type="checkbox" checked={chosen.includes(course.id)} onChange={event => toggle(course.id, event.target.checked)} />
        {course.name}</label>)}
      <label><input type="checkbox" checked={back} onChange={event => setBack(event.target.checked)} data-testid="layout-runner-back" />{runnerText.backCourse}</label>
    </fieldset>
    <PrintOverview cards={cards} selected={openKey} onOpen={openCard} templates={view.event.paperTemplates ?? []} readOnly={!canEdit}
      onApplyTemplate={applyTemplate} onPrintMarked={keys => setPrintOnly(new Set(keys))}
      thumb={card => <SheetView sheet={sheets[card.index]!.sheet} index={1000 + card.index} symbols={symbols} images={images} colorsKey={colors.colorsKey}
        courseColor={colors.courseColor} label={card.label} pressLayers={colors.pressLayers} testId="print-thumb" paper={{ ...paperSpace.interaction, editable: false }} />} />
    {adjustable && <AdjustPanel document={document} layout={layout} course={focus} scale={sheets[0]?.sheet.frames[0]?.printScale} canEdit={canEdit} save={save} />}
    <div className={printStyles.editorBody}>
      <div className={printStyles.sheets}>
        {sheets.map((item, index) => <div key={item.key} id={`print-sheet-${index}`} className={`${printStyles.sheetSlot} ${styles.sheetWrap}`}
          data-open={openKey === item.key ? "" : undefined} data-target={targetSlot === item ? "" : undefined}
          data-noprint={printOnly && !printOnly.has(item.key) ? "" : undefined}>
          <SheetView sheet={item.sheet} index={index} symbols={symbols} images={images} colorsKey={colors.colorsKey} courseColor={colors.courseColor}
            label={item.label} onPlace={canEdit ? placeDescription : undefined} paper={interaction} pressLayers={colors.pressLayers} />
          {adjustable && canEdit && item.sheet.frames[0]?.course && item.sheet.frames[0].course !== ALL_CONTROLS && !item.sheet.back
            && <NumberLayer sheet={item.sheet} onMove={(courseControl, at) => void save([{ type: "MOVE_NUMBER", course: item.sheet.frames[0]!.course, courseControl, at,
              printLayout: layout }])} />}
        </div>)}
      </div>
      <div className={`${printStyles.controls} ${printStyles.editorPanels}`} data-testid="print-editor-panels">
        {editing && <SheetPaperPanel raceId={raceId} document={view} target={target} readOnly={!canEdit} onSave={panel.onSave}
          frameEditing={frameEditing} onFrameEditing={setFrameEditing} layout={adjustable ? { name: layoutName, onEdit: () => focusLayoutScale(layout) } : undefined} />}
        <SheetLayoutPanel saved={document.event.layoutTemplates ?? []} selectedId={sheetLayoutId(document, layout)} readOnly={!canEdit}
          onSelect={id => { setDraft(undefined); void save([{ type: "UPDATE_LAYOUT", layout, changes: { layoutTemplate: id === "NONE" ? null : id } }]); }}
          onDraft={setDraft} onSave={save} />
        {panel && <PaperSpacePanel raceId={raceId} document={view} readOnly={!canEdit} {...panel} onCourse={choosePaperCourse} />}
        <PaperDescriptionsPanel document={view} courses={paperCourses(view, chosen)} placed={placed} readOnly={!canEdit} onSave={sheetSave} />
      </div>
    </div>
    <p className={printStyles.muted}>{outputText.editorHelp}</p>
  </section>;
}

/** "Kartor per ark" för layouten som id i mallpanelen ("NONE" = en bana per ark). */
function sheetLayoutId(document: CourseSettingDocument, layout: string): string {
  return (layout === MAIN_LAYOUT ? document.event.mainLayout?.layoutTemplate : document.event.layouts?.find(row => row.id === layout)?.layoutTemplate) ?? "NONE";
}

/** "Ändra i layouten": layoutens skala i listan, i bild och markerad. */
function focusLayoutScale(layout: string) {
  const field = window.document.querySelector<HTMLInputElement>(`[data-testid=layout-entry][data-layout="${CSS.escape(layout)}"] [data-testid=layout-scale]`);
  field?.scrollIntoView({ behavior: "smooth", block: "center" });
  field?.focus();
}
