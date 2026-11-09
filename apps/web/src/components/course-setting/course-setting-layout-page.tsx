"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTexts } from "../language-provider";
import { layoutEn } from "../../i18n/course-setting-layout-en";
import Link from "next/link";
import type { CourseSettingEditsRequest, MapBundleResponse } from "@o-tid/contracts";
import {
  applyEdit, descriptionSymbols, layoutEntries, objectPatch, type CourseSettingDocument, type CourseSettingEdit, type DescriptionSymbol, type MapRect
} from "@o-tid/course-setting";
import { layoutSv } from "../../i18n/course-setting-layout-sv";
import { fetchCourseSetting, saveCourseSettingEdits } from "../../lib/course-setting-api";
import { saveOnLatest, serialSaves } from "../../lib/course-setting-save-latest";
import { symbolLookup } from "../../lib/course-setting-description-draw";
import { fetchMapBundles } from "../../lib/map-bundles-client";
import { classRows, layoutMatrix } from "../../lib/course-setting-layouts";
import { AccountMenu } from "../account-menu";
import { HelpButton } from "../help/help-panel";
import { Button, Notice } from "../ui";
import { CourseSettingTabs } from "./course-setting-tabs";
import { LayoutMatrix } from "./course-setting-layout-matrix";
import { LayoutList } from "./course-setting-layout-list";
import { LayoutSheets } from "./course-setting-layout-sheets";
import { usePrintMap } from "./use-print-map";
import { LayoutClasses } from "./course-setting-layout-classes";
import { LayoutStates } from "./course-setting-layout-states";
import styles from "./course-setting-layout.module.css";


/**
 * ADR-0217: `/admin/[raceId]/course-setting/layout`, fliken Layout (paper space). Överblicken (banor × layouter), layouterna,
 * det öppnade arket, klasserna och lägena. Ändringarna sparas en i taget på senaste versionen (som utskriftssidan); "Ångra"
 * sätter tillbaka det som ändringen ändrade (`objectPatch`), också en återställning av ett läge.
 */
export function CourseLayoutPage({ raceId }: { raceId: string }) {
  const text = useTexts(layoutSv, layoutEn);
  const [document, setDocument] = useState<CourseSettingDocument | null>();
  const [canEdit, setCanEdit] = useState(false);
  const [mapBounds, setMapBounds] = useState<MapRect>();
  const [hasMap, setHasMap] = useState(false);
  const [mapSha256, setMapSha256] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [open, setOpen] = useState<{ course: string; layout: string }>();
  const versionRef = useRef<number>(undefined);
  const documentRef = useRef<CourseSettingDocument | null | undefined>(undefined);
  const serial = useMemo(() => serialSaves(), []);
  const undo = useRef<CourseSettingEdit[][]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const load = useCallback(async () => {
    setFailed(false);
    try {
      const state = await fetchCourseSetting(raceId);
      const next = (state.setting?.document ?? null) as unknown as CourseSettingDocument | null;
      setDocument(next); documentRef.current = next;
      versionRef.current = state.setting?.version;
      setCanEdit(state.access.level === "EDIT");
      setHasMap(state.mapFile !== null); setMapSha256(state.mapFile?.sha256);
      if (state.mapFile?.bounds) setMapBounds(state.mapFile.bounds);
    } catch { setFailed(true); }
  }, [raceId]);
  useEffect(() => { void load(); }, [load]);
  // Länken från Banläggning och Utskrift öppnar ett ark: ?course=<bana>&layout=<layout> (utan layout: huvudlayouten).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const course = params.get("course");
    if (course) setOpen({ course, layout: params.get("layout") ?? "MAIN" });
  }, []);

  // Klasserna och kartorna ur Kartor till starten (tävlingens klasser och banor); utan dem visas bara banorna.
  const [bundles, setBundles] = useState<MapBundleResponse>();
  useEffect(() => { fetchMapBundles(raceId).then(setBundles, () => setBundles(undefined)); }, [raceId]);

  // Kartan och färgerna som i Utskrift (ADR-0217 fas 3: arken redigeras här).
  const map = usePrintMap(raceId, hasMap && (mapSha256 ?? true), bounds => setMapBounds(current => current ?? bounds));

  const save = useCallback((edits: CourseSettingEdit[], record = true): Promise<boolean> => serial(async () => {
    let attempts = 0;
    let before: CourseSettingDocument | null | undefined;
    const result = await saveOnLatest({
      latest: async () => { if (attempts++ > 0 || versionRef.current === undefined) await load(); before = documentRef.current; return versionRef.current; },
      attempt: async baseVersion => {
        const saved = await saveCourseSettingEdits(raceId, { formatVersion: 1, requestId: crypto.randomUUID(), baseVersion,
          edits: edits as unknown as CourseSettingEditsRequest["edits"] });
        await load();
        if (saved.rejected.length === 0) return "saved";
        console.warn("Layouten avvisades", saved.rejected);
        return "conflict";
      }
    });
    setSaveFailed(!result.saved);
    // Ångra: det som ändringen ändrade, räknat på dokumentet före och efter (andras ändringar står kvar).
    if (result.saved && record && before) {
      try {
        const after = edits.reduce((doc, edit) => applyEdit(doc, edit).document, before);
        const inverse = objectPatch(after, before);
        if (inverse) { undo.current = [...undo.current.slice(-19), [inverse]]; setUndoCount(undo.current.length); }
      } catch { /* Ingen ångra för en ändring som inte går att räkna lokalt. */ }
    }
    return result.saved;
  }), [raceId, load, serial]);
  const onUndo = () => {
    const last = undo.current.pop();
    setUndoCount(undo.current.length);
    if (last) void save(last, false);
  };

  const symbols = useMemo(() => {
    try { return symbolLookup(descriptionSymbols(document?.event.descriptionStandard ?? "2018")); }
    catch { return symbolLookup([] as DescriptionSymbol[]); }
  }, [document?.event.descriptionStandard]);
  const matrix = useMemo(() => document ? layoutMatrix(document, bundles, text.mainName, { mapBounds }) : undefined, [document, bundles, mapBounds]);
  const classes = useMemo(() => document ? classRows(document, bundles) : [], [document, bundles]);
  const entries = useMemo(() => document ? layoutEntries(document, text.mainName) : [], [document]);

  const head = <div className={styles.topLine}>
    <Link className={styles.back} href={`/admin/${raceId}/manage`}>←</Link>
    <CourseSettingTabs raceId={raceId} current="LAYOUT" />
    <span className={styles.spacer} />
    {canEdit && <Button variant="secondary" disabled={undoCount === 0} onClick={onUndo} data-testid="layout-undo">{text.states.undo}</Button>}
    <HelpButton view={["CS_PRINT_PAGE", "CS_PRINT", "COURSE_SETTING"]} />
    <AccountMenu />
  </div>;
  if (failed) return <main className={styles.page}>{head}<Notice tone="error" role="alert"><p>{text.failed}</p>
    <div><Button variant="secondary" onClick={() => void load()}>{text.retry}</Button></div></Notice></main>;
  if (document === undefined) return <main className={styles.page}>{head}<p role="status">{text.loading}</p></main>;
  if (document === null || !matrix) return <main className={styles.page}>{head}<p>{text.noSetting}</p></main>;
  const layoutName = (id: string) => entries.find(entry => entry.id === id)?.name ?? id;
  const courseName = (id: string) => id === "ALL_CONTROLS" ? text.overview.allControls : document.courses.find(row => row.id === id)?.name ?? id;
  const shown = open && entries.some(entry => entry.id === open.layout) && (open.course === "ALL_CONTROLS" || document.courses.some(row => row.id === open.course)) ? open : undefined;
  const addSheet = async (course: string, layout: string) => {
    if (await save([{ type: "PUT_LAYOUT_SHEET", layout, course, sheet: {} }])) setOpen({ course, layout });
  };
  return <main className={styles.page} data-testid="layout-page">
    {head}
    <h1>{text.title}</h1>
    <p className={styles.muted}>{canEdit ? text.intro : text.readOnly}</p>
    {saveFailed && <Notice tone="error" role="alert"><p>{text.saveFailed}</p></Notice>}
    {map.mapState === "reading" && <p className={styles.muted} role="status">{text.readingMap}</p>}
    <LayoutMatrix columns={matrix.columns} rows={matrix.rows} open={shown} readOnly={!canEdit}
      onOpen={(course, layout) => setOpen({ course, layout })} onAdd={(course, layout) => void addSheet(course, layout)} />
    {shown && <LayoutSheets key={shown.layout} raceId={raceId} document={document} layout={shown.layout} focus={shown.course} layoutName={layoutName(shown.layout)}
      canEdit={canEdit} save={save} map={map} mapBounds={mapBounds} symbols={symbols} onClose={() => setOpen(undefined)} />}
    <div className={styles.columns}>
      <LayoutList document={document} entries={entries} readOnly={!canEdit} save={save}
        sheetCount={id => matrix.rows.filter(row => row.cells.some(cell => cell.layout === id && cell.exists)).length} />
      <LayoutClasses rows={classes} entries={entries} readOnly={!canEdit} save={save} />
      <LayoutStates document={document} readOnly={!canEdit} save={save} layoutName={layoutName} courseName={courseName} />
    </div>
  </main>;
}
