"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { CourseSettingEditsRequest, MapBundleResponse } from "@o-tid/contracts";
import {
  applyEdit, descriptionSymbols, layoutEntries, objectPatch, type CourseSettingDocument, type CourseSettingEdit, type DescriptionSymbol, type MapRect
} from "@o-tid/course-setting";
import { layoutSv as text } from "../../i18n/course-setting-layout-sv";
import { fetchCourseSetting, saveCourseSettingEdits } from "../../lib/course-setting-api";
import { saveOnLatest, serialSaves } from "../../lib/course-setting-save-latest";
import { symbolLookup } from "../../lib/course-setting-description-draw";
import { MapRenderSession } from "../../lib/course-setting-map-protocol";
import { controlledWorker } from "../../lib/course-setting-worker";
import { fetchMapBundles } from "../../lib/map-bundles-client";
import { fetchMapSource } from "../../lib/route-choice-api";
import { classRows, layoutMatrix } from "../../lib/course-setting-layouts";
import { AccountMenu } from "../account-menu";
import { Button, Notice } from "../ui";
import { CourseSettingTabs } from "./course-setting-tabs";
import { LayoutMatrix } from "./course-setting-layout-matrix";
import { LayoutList } from "./course-setting-layout-list";
import { LayoutSheetEditor } from "./course-setting-layout-sheet";
import { LayoutClasses } from "./course-setting-layout-classes";
import { LayoutStates } from "./course-setting-layout-states";
import styles from "./course-setting-layout.module.css";

const createMapWorker = () => controlledWorker(() => new Worker(new URL("../../lib/course-setting-map-worker.ts", import.meta.url), { type: "module" }));

/**
 * ADR-0217: `/admin/[raceId]/course-setting/layout`, fliken Layout (paper space). Överblicken (banor × layouter), layouterna,
 * det öppnade arket, klasserna och lägena. Ändringarna sparas en i taget på senaste versionen (som utskriftssidan); "Ångra"
 * sätter tillbaka det som ändringen ändrade (`objectPatch`), också en återställning av ett läge.
 */
export function CourseLayoutPage({ raceId }: { raceId: string }) {
  const [document, setDocument] = useState<CourseSettingDocument | null>();
  const [canEdit, setCanEdit] = useState(false);
  const [mapBounds, setMapBounds] = useState<MapRect>();
  const [hasMap, setHasMap] = useState(false);
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
      setHasMap(state.mapFile !== null);
      if (state.mapFile?.bounds) setMapBounds(state.mapFile.bounds);
    } catch { setFailed(true); }
  }, [raceId]);
  useEffect(() => { void load(); }, [load]);

  // Klasserna och kartorna ur Kartor till starten (tävlingens klasser och banor); utan dem visas bara banorna.
  const [bundles, setBundles] = useState<MapBundleResponse>();
  useEffect(() => { fetchMapBundles(raceId).then(setBundles, () => setBundles(undefined)); }, [raceId]);

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
    {mapState === "reading" && <p className={styles.muted} role="status">{text.readingMap}</p>}
    <LayoutMatrix columns={matrix.columns} rows={matrix.rows} open={shown} readOnly={!canEdit}
      onOpen={(course, layout) => setOpen({ course, layout })} onAdd={(course, layout) => void addSheet(course, layout)} />
    {shown && <LayoutSheetEditor key={`${shown.layout}|${shown.course}`} raceId={raceId} document={document} layout={shown.layout} course={shown.course}
      canEdit={canEdit} save={save} session={session} mapBounds={mapBounds} symbols={symbols} onClose={() => setOpen(undefined)} />}
    <div className={styles.columns}>
      <LayoutList document={document} entries={entries} readOnly={!canEdit} save={save}
        sheetCount={id => matrix.rows.filter(row => row.cells.some(cell => cell.layout === id && cell.exists)).length} />
      <LayoutClasses rows={classes} entries={entries} readOnly={!canEdit} save={save} />
      <LayoutStates document={document} readOnly={!canEdit} save={save} layoutName={layoutName} courseName={courseName} />
    </div>
  </main>;
}
