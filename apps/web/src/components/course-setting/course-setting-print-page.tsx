"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { CourseSettingEditsRequest, MapBundleResponse } from "@o-tid/contracts";
import {
  BUILT_IN_PRINT_PROFILES, BUILT_IN_TEMPLATES, cmykToCss, descriptionSymbols, layoutCoursePage, layoutTemplateSheets, mapColorAdjust, printVariants,
  sheetOfPage, type CourseSettingDocument, type CourseSettingEdit, type DescriptionSymbol, type LayoutTemplate, type MapColorAdjust, type MapRect,
  type Sheet, type SheetItem
} from "@o-tid/course-setting";
import type { ColorUsage, MapColor } from "@o-tid/map-file";
import { coursePrintSv as text } from "../../i18n/course-setting-print-sv";
import { layoutTemplateSv } from "../../i18n/course-setting-print-profile-sv";
import { formatClockTime } from "../../lib/clock-time";
import { fetchCourseSetting, saveCourseSettingEdits } from "../../lib/course-setting-api";
import { symbolLookup } from "../../lib/course-setting-description-draw";
import { MapRenderSession } from "../../lib/course-setting-map-protocol";
import { mapRenderRequest, pageStyles } from "../../lib/course-setting-print";
import { ALL_CONTROLS } from "../../lib/course-setting-hit";
import { runnerPrintItems, type RunnerPrint, type RunnerPrintProblem } from "../../lib/course-setting-runner-print";
import { controlledWorker } from "../../lib/course-setting-worker";
import { fetchMapBundles } from "../../lib/map-bundles-client";
import { fetchMapSource } from "../../lib/route-choice-api";
import { RenderQueue } from "../../lib/course-setting-bl-proposal";
import { Button, Notice } from "../ui";
import { BlProposalPanel } from "./course-setting-bl-proposal";
import type { RenderImage, RenderView } from "./course-setting-bl-compare";
import { PrintProfilePanel } from "./course-setting-print-profile";
import { PdfPanel } from "./course-setting-pdf-panel";
import { printPdfSv as pdfText } from "../../i18n/course-setting-print-pdf-sv";
import { LayoutTemplatePanel } from "./course-setting-print-template";
import { frameImageKey, SheetView } from "./course-setting-sheet";
import styles from "./course-setting-print-page.module.css";

// Steg 67: styrd av service workern när banläggningen är sparad för offline (`controlledWorker`).
const createMapWorker = () => controlledWorker(() => new Worker(new URL("../../lib/course-setting-map-worker.ts", import.meta.url), { type: "module" }));

type Mode = "COURSES" | "RUNNERS";
interface Printed { readonly key: string; readonly sheet: Sheet; readonly label: string }
type Adjust = Readonly<Record<number, MapColorAdjust>>;

/**
 * En kartbild som bild-URL (ritad av Workern med `drawMap`). Workern ritar bara den senaste beställningen, så alla bilder
 * går genom en kö (`RenderQueue`): BL-förslagets små kartbitar före arkens stora bilder.
 */
async function renderView(session: MapRenderSession, request: RenderView): Promise<string> {
  const bitmap = await new Promise<ImageBitmap>(resolve => session.render(request, (_id, image) => resolve(image)));
  const canvas = window.document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  return blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/png");
}

const clockIn = (timeZone: string) => (instant: string | null) => {
  if (!instant) return "";
  const full = formatClockTime(instant, timeZone);
  return full.endsWith(":00") ? full.slice(0, 5) : full;
};

function problemText(problem: RunnerPrintProblem): string {
  switch (problem.kind) {
    case "MISSING_VARIANT": return text.page.problem.MISSING_VARIANT(problem.name, problem.className);
    case "UNKNOWN_COURSE": return text.page.problem.UNKNOWN_COURSE(problem.courseName);
    case "UNKNOWN_VARIANT": return text.page.problem.UNKNOWN_VARIANT(problem.courseName, problem.variantCode);
    case "COUNT": return text.page.problem.COUNT(problem.variantCode ? `${problem.courseName} ${problem.variantCode}` : problem.courseName, problem.expected, problem.actual);
  }
}

/**
 * Steg 64 (ADR-0180 beslut 11, ADR-0183): `/admin/[raceId]/course-setting/print`. Arken för valda banor (och varianter)
 * eller en karta per löpare ur kartbuntarna, utlagda som i Purple Pen (`layoutCoursePage`) eller i en layoutmall
 * (`layoutTemplateSheets`), med kartan ritad av Workern i utskriftsprofilens färger och banpåtrycket som SVG i papperets
 * mm. Webbläsarens utskrift ger ett utkast; steg 65: "Skapa PDF för tryck" lägger samma ark i serverns kö och ger en PDF med
 * kartan som vektorer, dekorfärger och övertryck (`PdfPanel`).
 */
export function CoursePrintPage({ raceId }: { raceId: string }) {
  const [document, setDocument] = useState<CourseSettingDocument | null>();
  const [version, setVersion] = useState<number>();
  const [canEdit, setCanEdit] = useState(false);
  const [mapBounds, setMapBounds] = useState<MapRect>();
  const [hasMap, setHasMap] = useState(false);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [eachVariant, setEachVariant] = useState(false);
  const [header, setHeader] = useState(false);
  const [mode, setMode] = useState<Mode>("COURSES");
  const [templateId, setTemplateId] = useState("NONE");
  const [draftTemplate, setDraftTemplate] = useState<LayoutTemplate>();
  const [fill, setFill] = useState<"FILL" | "REPEAT">("FILL");
  const [profileId, setProfileId] = useState<string>();
  const [order, setOrder] = useState<"BUNDLE" | "START">("BUNDLE");
  const [duplex, setDuplex] = useState(false);
  const load = useCallback(async (first = false) => {
    setFailed(false);
    try {
      const state = await fetchCourseSetting(raceId);
      const next = (state.setting?.document ?? null) as unknown as CourseSettingDocument | null;
      setDocument(next);
      setVersion(state.setting?.version);
      setCanEdit(state.access.level === "EDIT");
      setHasMap(state.mapFile !== null);
      if (state.mapFile?.bounds) setMapBounds(state.mapFile.bounds);
      if (next && first) {
        const wanted = new URLSearchParams(window.location.search).get("course");
        setChosen(wanted && (wanted === ALL_CONTROLS || next.courses.some(course => course.id === wanted)) ? [wanted]
          : [...next.courses].sort((a, b) => a.order - b.order).map(course => course.id));
      }
    } catch { setFailed(true); }
  }, [raceId]);
  useEffect(() => { void load(true); }, [load]);

  // Kartfilen i en Worker; sidornas bilder ritas en i taget.
  const [session, setSession] = useState<MapRenderSession>();
  const [mapState, setMapState] = useState<"none" | "reading" | "ready" | "failed">("none");
  const [colors, setColors] = useState<readonly MapColor[]>([]);
  const [usage, setUsage] = useState<ReadonlyMap<number, ColorUsage>>(new Map());
  const queue = useRef(new RenderQueue());
  const renderImage = useCallback<RenderImage>((view, priority) => {
    if (!session) return Promise.reject(new Error("Kartan är inte inläst"));
    return queue.current.add(() => renderView(session, view), priority);
  }, [session]);
  useEffect(() => {
    if (!hasMap) return;
    const controller = new AbortController();
    let created: MapRenderSession | undefined;
    setMapState("reading");
    void fetchMapSource(raceId, controller.signal).then(file => {
      created = new MapRenderSession(createMapWorker, (bounds, _scale, _georeference, mapColors, mapUsage) => {
        setMapBounds(current => current ?? bounds); setColors(mapColors); setUsage(mapUsage); setSession(created); setMapState("ready");
      }, () => setMapState("failed"));
      created.load(file.bytes, file.fileName);
    }, () => { if (!controller.signal.aborted) setMapState("failed"); });
    return () => { controller.abort(); created?.close(); };
  }, [raceId, hasMap]);

  // Kartbuntarna (steg 61) när en karta per löpare skrivs ut.
  const [bundles, setBundles] = useState<MapBundleResponse>();
  const [bundlesState, setBundlesState] = useState<"none" | "reading" | "ready" | "failed">("none");
  useEffect(() => {
    if (mode !== "RUNNERS" || bundlesState !== "none") return;
    setBundlesState("reading");
    fetchMapBundles(raceId).then(data => { setBundles(data); setBundlesState("ready"); }, () => setBundlesState("failed"));
  }, [mode, bundlesState, raceId]);

  const save = useCallback(async (edits: CourseSettingEdit[]) => {
    if (version === undefined) return false;
    try {
      await saveCourseSettingEdits(raceId, { formatVersion: 1, requestId: crypto.randomUUID(), baseVersion: version,
        edits: edits as unknown as CourseSettingEditsRequest["edits"] });
      await load();
      return true;
    } catch (error) { console.error("Utskriftsinställningen sparades inte", error); return false; }
  }, [raceId, version, load]);

  const standard = document?.event.descriptionStandard ?? "2018";
  const symbols = useMemo(() => {
    try { return symbolLookup(descriptionSymbols(standard)); } catch (error) { console.error("Symbolerna misslyckades", error); return symbolLookup([] as DescriptionSymbol[]); }
  }, [standard]);
  const courses = useMemo(() => [...(document?.courses ?? [])].sort((a, b) => a.order - b.order), [document]);

  // Utskriftsprofilen: vald här, annars tävlingens, annars "som i filen".
  const savedProfiles = useMemo(() => document?.event.printProfiles ?? [], [document]);
  const activeProfileId = profileId ?? document?.event.printProfileId ?? BUILT_IN_PRINT_PROFILES[0]!.id;
  const profile = [...BUILT_IN_PRINT_PROFILES, ...savedProfiles].find(item => item.id === activeProfileId) ?? BUILT_IN_PRINT_PROFILES[0]!;
  const adjust = useMemo<Adjust>(() => mapColorAdjust(profile, colors), [profile, colors]);
  const colorsKey = useMemo(() => JSON.stringify(adjust), [adjust]);
  const courseColor = cmykToCss(profile.course.cmyk);
  function chooseProfile(wanted: string) {
    // En BL-profil som redan godkänts för tävlingen: välj kopian med besluten.
    const id = savedProfiles.find(item => item.basedOn === wanted && item.reference)?.id ?? wanted;
    setProfileId(id);
    if (canEdit && id !== document?.event.printProfileId) void save([{ type: "SET_EVENT", changes: { printProfileId: id } }]);
  }

  const savedTemplates = useMemo(() => document?.event.layoutTemplates ?? [], [document]);
  const runnerDefault = duplex ? "a4-one" : "a4-strip";
  const chosenTemplateId = mode === "RUNNERS" && templateId === "NONE" ? runnerDefault : templateId;
  const template = draftTemplate ?? [...BUILT_IN_TEMPLATES, ...savedTemplates].find(item => item.id === chosenTemplateId);

  const runners = useMemo<RunnerPrint | undefined>(() => document && bundles
    ? runnerPrintItems(document, bundles, clockIn(bundles.timeZone), order) : undefined, [document, bundles, order]);

  // Kartorna i banläget (samma som arken nedan) för PDF:en.
  // Översynen 2026-11-02: en bana vars varianter inte går att räkna hoppas inte tyst över (felet visas med de andra).
  const { courseItems, variantErrors } = useMemo(() => {
    const items: SheetItem[] = [], failed: string[] = [];
    if (!document) return { courseItems: items, variantErrors: failed };
    for (const course of [ALL_CONTROLS, ...courses.map(item => item.id)].filter(id => chosen.includes(id))) {
      try {
        for (const variant of printVariants(document, course, eachVariant)) items.push({ course, ...(variant ? { variant } : {}) });
      } catch (error) {
        console.error("Varianterna misslyckades", error);
        failed.push(course === ALL_CONTROLS ? text.print.allControls : courses.find(item => item.id === course)?.name ?? course);
      }
    }
    return { courseItems: items, variantErrors: failed };
  }, [document, courses, chosen, eachVariant]);

  const { sheets, errors } = useMemo(() => {
    const out: Printed[] = [], bad: string[] = mode === "RUNNERS" ? [] : [...variantErrors];
    if (!document) return { sheets: out, errors: bad };
    const options = { mapBounds, ...(bundles ? { date: bundles.raceDate } : {}) };
    if (mode === "RUNNERS") {
      if (!runners || !template) return { sheets: out, errors: bad };
      runners.items.forEach((item, index) => {
        try {
          // En löpare per ark: remsan och baksidan gäller arkets löpare.
          for (const [part, sheet] of layoutTemplateSheets(document, template, [item], { ...options, duplexBacks: duplex }).entries()) {
            out.push({ key: `r${index}|${part}`, sheet, label: [sheet.frames[0]?.title ?? "", item.runner?.name ?? item.runner?.kind ?? ""].filter(Boolean).join(" – ") });
          }
        } catch (error) { console.error("Utskriftslayouten misslyckades", error); bad.push(item.runner?.name ?? item.course); }
      });
      return { sheets: out, errors: bad };
    }
    const items = courseItems;
    const nameOf = (course: string) => course === ALL_CONTROLS ? text.print.allControls : courses.find(item => item.id === course)?.name ?? course;
    if (template) {
      try {
        layoutTemplateSheets(document, template, items, { ...options, mode: fill }).forEach((sheet, index) =>
          out.push({ key: `t${index}`, sheet, label: sheet.frames.map(frame => frame.title).join(", ") }));
      } catch (error) { console.error("Utskriftslayouten misslyckades", error); bad.push(template.name); }
      return { sheets: out, errors: bad };
    }
    for (const item of items) {
      try {
        for (const page of layoutCoursePage(document, { course: item.course, ...(item.variant ? { variant: item.variant } : {}), mapBounds, header })) {
          out.push({ key: `${item.course}|${item.variant ?? ""}|${page.sheet}`, sheet: sheetOfPage(page), label: text.page.sheet(page.title, page.sheet, page.sheets) });
        }
      } catch (error) { console.error("Utskriftslayouten misslyckades", error); bad.push(nameOf(item.course)); }
    }
    return { sheets: out, errors: bad };
  }, [document, courses, courseItems, variantErrors, header, mapBounds, mode, template, fill, runners, duplex, bundles]);

  // Kartbilderna per utsnitt och färger (samma utsnitt, skala och profil ritas en gång).
  const [images, setImages] = useState<Readonly<Record<string, string>>>({});
  const urls = useRef<string[]>([]);
  const started = useRef(new Set<string>());
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void (async () => {
      for (const { sheet } of sheets) for (const frame of sheet.frames) {
        const key = frameImageKey(frame, colorsKey);
        if (cancelled) return;
        if (started.current.has(key)) continue;
        started.current.add(key);
        try {
          const url = await renderImage({ ...mapRenderRequest(frame), ...(Object.keys(adjust).length > 0 ? { colorAdjust: adjust } : {}) }, 0);
          urls.current.push(url);
          // Bilden gäller sin nyckel (utsnitt och färger) även om arken ändrats under tiden: en senare körning hoppar över
          // nyckeln medan den ritas, så den måste sparas här (annars väntar arket för alltid).
          setImages(current => ({ ...current, [key]: url }));
        } catch (error) { started.current.delete(key); console.error("Kartan kunde inte ritas", error); }
      }
    })();
    return () => { cancelled = true; };
  }, [session, sheets, adjust, colorsKey, renderImage]);
  useEffect(() => () => { for (const url of urls.current) if (url.startsWith("blob:")) URL.revokeObjectURL(url); }, []);

  const toggle = (id: string, on: boolean) => setChosen(current => on ? [...current, id] : current.filter(item => item !== id));
  const allIds = [ALL_CONTROLS, ...courses.map(course => course.id)];
  const back = <Link className={styles.back} href={`/admin/${raceId}/course-setting`}>{text.page.back}</Link>;
  if (failed) return <main className={styles.page}><div className={styles.controls}>{back}<Notice tone="error" role="alert"><p>{text.page.failed}</p>
    <div><Button variant="secondary" onClick={() => void load(true)}>{text.page.retry}</Button></div></Notice></div></main>;
  if (document === undefined) return <main className={styles.page}><div className={styles.controls}>{back}<p role="status">{text.page.loading}</p></div></main>;
  if (document === null) return <main className={styles.page}><div className={styles.controls}>{back}<p>{text.page.noSetting}</p></div></main>;
  const frameCount = sheets.reduce((sum, item) => sum + item.sheet.frames.length, 0);
  const waiting = mapState === "reading" || (mapState === "ready" && sheets.some(item => item.sheet.frames.some(frame => !images[frameImageKey(frame, colorsKey)])));
  const blocked = mode === "RUNNERS" && (runners?.problems.length ?? 0) > 0;
  return <main className={styles.page}>
    <style>{pageStyles(sheets.map(item => item.sheet))}</style>
    <div className={styles.controls}>
      {back}
      <h1>{text.page.title}</h1>
      <Notice tone="attention"><p data-testid="print-draft">{text.page.draft}</p></Notice>
      <div className={styles.row} role="radiogroup" aria-label={text.page.mode}>
        <label className={styles.check}><input type="radio" name="print-mode" checked={mode === "COURSES"} onChange={() => { setMode("COURSES"); setDraftTemplate(undefined); }} />
          {text.page.modeCourses}</label>
        <label className={styles.check}><input type="radio" name="print-mode" checked={mode === "RUNNERS"} onChange={() => { setMode("RUNNERS"); setDraftTemplate(undefined); }}
          data-testid="print-mode-runners" />{text.page.modeRunners}</label>
      </div>
      {mode === "COURSES" ? <>
        <fieldset className={styles.courses}>
          <legend>{text.page.courses}</legend>
          <label><input type="checkbox" checked={allIds.every(id => chosen.includes(id))} onChange={event => setChosen(event.target.checked ? allIds : [])} />{text.page.all}</label>
          <label><input type="checkbox" checked={chosen.includes(ALL_CONTROLS)} onChange={event => toggle(ALL_CONTROLS, event.target.checked)} />{text.print.allControls}</label>
          {courses.map(course => <label key={course.id}><input type="checkbox" checked={chosen.includes(course.id)}
            onChange={event => toggle(course.id, event.target.checked)} />{course.name}</label>)}
        </fieldset>
        <div className={styles.row}>
          <label className={styles.check}><input type="checkbox" checked={eachVariant} onChange={event => setEachVariant(event.target.checked)} />{text.page.eachVariant}</label>
          {!template && <label className={styles.check}><input type="checkbox" checked={header} onChange={event => setHeader(event.target.checked)} />{text.page.header}</label>}
          {template && template.frames.length > 1 && <label className={styles.field}>{layoutTemplateSv.mode}
            <select value={fill} onChange={event => setFill(event.target.value as "FILL" | "REPEAT")} data-testid="print-fill">
              <option value="FILL">{text.page.fill}</option><option value="REPEAT">{text.page.repeat}</option></select></label>}
        </div>
      </> : <RunnerControls bundlesState={bundlesState} runners={runners} raceId={raceId} order={order} setOrder={setOrder} duplex={duplex} setDuplex={setDuplex} />}
      <div className={styles.row}>
        <Button onClick={() => window.print()} disabled={sheets.length === 0}>{text.page.print}</Button>
        <span role="status" data-testid="print-count">{sheets.length === 0 ? text.page.none : frameCount > sheets.length ? `${text.page.sheets(sheets.length)}, ${layoutTemplateSv.frames(frameCount)}`
          : text.page.pages(sheets.length)}{waiting ? ` – ${text.page.readingMap}` : ""}</span>
        {blocked && <span className={styles.muted}>{text.page.runnerProblems}</span>}
      </div>
      {!hasMap && <p className={styles.muted}>{text.page.noMap}</p>}
      {profile.reference && hasMap && <BlProposalPanel key={profile.id} profile={profile} builtIn={BUILT_IN_PRINT_PROFILES} colors={colors} usage={usage}
        readOnly={!canEdit} frame={sheets[0]?.sheet.frames[0]} symbols={symbols} render={renderImage}
        onSave={async edits => { const ok = await save(edits); if (ok) setProfileId(undefined); return ok; }} />}
      <PdfPanel raceId={raceId} profile={profile} colors={colors} usage={usage} disabled={sheets.length === 0 || blocked || errors.length > 0}
        blockedText={blocked ? pdfText.runnerBlocked : undefined}
        selection={{ items: mode === "RUNNERS" ? runners?.items ?? [] : courseItems, template, templateIsDraft: draftTemplate !== undefined,
          savedTemplateIds: savedTemplates.map(item => item.id), header, fill, perRunner: mode === "RUNNERS", duplex,
          ...(bundles ? { date: bundles.raceDate } : {}) }} />
      {mapState === "failed" && <Notice tone="attention">{text.page.mapFailed}</Notice>}
      {errors.map(name => <Notice key={name} tone="error">{text.page.failedCourse(name)}</Notice>)}
      <LayoutTemplatePanel key={mode} saved={savedTemplates} selectedId={chosenTemplateId} readOnly={!canEdit}
        onSelect={id => { setTemplateId(id); setDraftTemplate(undefined); }} onDraft={setDraftTemplate} onSave={save} />
      <PrintProfilePanel saved={savedProfiles} selectedId={profile.id} colors={colors} usage={usage} readOnly={!canEdit} onSelect={chooseProfile}
        onSave={async edits => { const ok = await save(edits); if (ok) setProfileId(undefined); return ok; }} />
    </div>
    <div className={styles.sheets}>
      {sheets.map((item, index) => <SheetView key={item.key} sheet={item.sheet} index={index} symbols={symbols} images={images} colorsKey={colorsKey}
        courseColor={courseColor} label={item.label} />)}
    </div>
  </main>;
}

function RunnerControls({ bundlesState, runners, raceId, order, setOrder, duplex, setDuplex }: {
  bundlesState: "none" | "reading" | "ready" | "failed"; runners: RunnerPrint | undefined; raceId: string;
  order: "BUNDLE" | "START"; setOrder: (order: "BUNDLE" | "START") => void; duplex: boolean; setDuplex: (on: boolean) => void;
}) {
  if (bundlesState === "reading" || bundlesState === "none") return <p role="status">{text.page.runnersLoading}</p>;
  if (bundlesState === "failed" || !runners) return <Notice tone="error">{text.page.runnersFailed}</Notice>;
  return <div className={styles.stack} data-testid="print-runners">
    <div className={styles.row}>
      <label className={styles.field}>{text.page.order}<select value={order} onChange={event => setOrder(event.target.value as "BUNDLE" | "START")}>
        <option value="BUNDLE">{text.page.orderBundle}</option><option value="START">{text.page.orderStart}</option></select></label>
      <label className={styles.check}><input type="radio" name="print-duplex" checked={!duplex} onChange={() => setDuplex(false)} />{text.page.singleSided}</label>
      <label className={styles.check}><input type="radio" name="print-duplex" checked={duplex} onChange={() => setDuplex(true)} data-testid="print-duplex" />{text.page.duplex}</label>
    </div>
    {runners.items.length === 0 && <p className={styles.muted}>{text.page.runnersNone}</p>}
    {runners.counts.length > 0 && <p className={styles.muted}>{text.page.runnerCounts}: {runners.counts.map(row =>
      `${row.courseName} ${row.variantCode ?? text.page.noVariant} ${row.count}`).join(" · ")}</p>}
    {runners.problems.length === 0 ? <Notice tone="ok"><p data-testid="print-runner-check">{text.page.runnerOk}</p></Notice>
      : <Notice tone="error"><p data-testid="print-runner-check">{text.page.runnerProblems}</p>
        <ul className={styles.problems}>{runners.problems.map((problem, index) => <li key={index}>{problemText(problem)}</li>)}</ul>
        <p><Link href={`/admin/${raceId}/maps`}>{text.page.bundlesLink}</Link></p></Notice>}
  </div>;
}
