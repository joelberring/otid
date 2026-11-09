"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sheetLayoutEn } from "../../i18n/course-setting-print-more-en";
import { printPdfEn } from "../../i18n/course-setting-print-more-en";
import { printOutputEn } from "../../i18n/course-setting-print-en";
import { runnerPrintEn } from "../../i18n/course-setting-print-more-en";
import { coursePrintEn } from "../../i18n/course-setting-print-en";
import { printWhatEn } from "../../i18n/course-setting-layout-en";
import { trainingEn } from "../../i18n/course-setting-training-en";
import { useTexts } from "../language-provider";
import { layoutEn } from "../../i18n/course-setting-layout-en";
import { AccountMenu } from "../account-menu";
import Link from "next/link";
import type { CourseSettingEditsRequest, MapBundleResponse } from "@o-tid/contracts";
import {
  exchangeAfterPart, expandPartItems, expandTrainingItems, isFlip, BUILT_IN_PRINT_PROFILES, BUILT_IN_SHEET_LAYOUTS, descriptionSymbols, printSheetGroups, layoutEntries,
  sheetLayoutOfLayout, MAIN_LAYOUT, type CourseSettingDocument, type CourseSettingEdit, type DescriptionSymbol, type MapRect, type Sheet, type SheetItem
} from "@o-tid/course-setting";
import { coursePrintSv } from "../../i18n/course-setting-print-sv";
import { sheetLayoutSv } from "../../i18n/course-setting-print-profile-sv";
import { formatClockTime } from "../../lib/clock-time";
import { fetchCourseSetting, saveCourseSettingEdits } from "../../lib/course-setting-api";
import { saveOnLatest, serialSaves } from "../../lib/course-setting-save-latest";
import { SaveFailed } from "./save-failed";
import { symbolLookup } from "../../lib/course-setting-description-draw";
import { pageStyles } from "../../lib/course-setting-print";
import { ALL_CONTROLS } from "../../lib/course-setting-hit";
import { safely } from "../../lib/course-setting-safely";
import { trainingSv } from "../../i18n/course-setting-training-sv";
import { runnerPrintItems, type RunnerPrint } from "../../lib/course-setting-runner-print";
import { ALL_RUNNERS, runnerCheckRows, runnerPages, selectRunnerItems, type CheckRow, type RunnerSelection } from "../../lib/course-setting-runner-select";
import { runnerPrintSv } from "../../i18n/course-setting-runner-print-sv";
import { RunnerControls, type BackMode } from "./course-setting-runner-panel";
import { RunnerCheckTable } from "./course-setting-runner-check";
import { fetchMapBundles } from "../../lib/map-bundles-client";
import { classItems, layoutItems, proofItems, withCopies, type PrintCount } from "../../lib/course-setting-print-what";
import { layoutSv } from "../../i18n/course-setting-layout-sv";
import { printWhatSv } from "../../i18n/course-setting-layout-sv";
import { CourseSettingTabs } from "./course-setting-tabs";
import { usePrintColors, usePrintMap, useSheetImages } from "./use-print-map";
import { PrintWhat } from "./course-setting-print-what";
import { pressNormOf } from "../../lib/course-setting-press-layers";
import { Button, Notice } from "../ui";
import { BlProposalPanel } from "./course-setting-bl-proposal";
import { PrintColors } from "./course-setting-print-colors";
import { printOutputSv } from "../../i18n/course-setting-print-overview-sv";
import { PdfPanel } from "./course-setting-pdf-panel";
import { printPdfSv } from "../../i18n/course-setting-print-pdf-sv";
import { frameImageKey, SheetView } from "./course-setting-sheet";
import { HelpButton, HelpLink } from "../help/help-panel";
import { useDetailGaps } from "./course-setting-circle-cutting";
import { readOnlyPaper } from "./course-setting-paper-items";
import { paperImageUrl } from "../../lib/course-setting-paper-api";
import styles from "./course-setting-print-page.module.css";

/** PDF-jobbet får löparens uppgifter för kartan men inte deltagarens id (det behövs bara för urvalet på sidan, ADR-0213). */
function withoutEntry(item: SheetItem): SheetItem {
  if (!item.runner?.entryId) return item;
  const runner = { ...item.runner };
  delete runner.entryId;
  return { ...item, runner };
}

type Mode = "COURSES" | "RUNNERS" | "CLASSES" | "PROOF";
interface Printed { readonly key: string; readonly sheet: Sheet; readonly label: string }

const clockIn = (timeZone: string) => (instant: string | null) => {
  if (!instant) return "";
  const full = formatClockTime(instant, timeZone);
  return full.endsWith(":00") ? full.slice(0, 5) : full;
};

/**
 * Steg 64 (ADR-0180 beslut 11, ADR-0183): `/admin/[raceId]/course-setting/print`. Arken för valda banor (och varianter)
 * eller en karta per löpare ur kartbuntarna, utlagda som i Purple Pen (`layoutCoursePage`) eller i en layoutmall
 * (`sheetLayoutSheets`), med kartan ritad av Workern i utskriftsprofilens färger och banpåtrycket som SVG i papperets
 * mm. Webbläsarens utskrift ger ett utkast; steg 65: "Skapa PDF för tryck" lägger samma ark i serverns kö och ger en PDF med
 * kartan som vektorer, dekorfärger och övertryck (`PdfPanel`).
 */
export function CoursePrintPage({ raceId, initialMode = "COURSES" }: { raceId: string; initialMode?: Mode }) {
  const sheetLayoutText = useTexts(sheetLayoutSv, sheetLayoutEn);
  const pdfText = useTexts(printPdfSv, printPdfEn);
  const outputText = useTexts(printOutputSv, printOutputEn);
  const runnerText = useTexts(runnerPrintSv, runnerPrintEn);
  const text = useTexts(coursePrintSv, coursePrintEn);
  const whatText = useTexts(printWhatSv, printWhatEn);
  const layoutText = useTexts(layoutSv, layoutEn);
  const trainingText = useTexts(trainingSv, trainingEn);
  const [loaded, setDocument] = useState<CourseSettingDocument | null>();
  const [canEdit, setCanEdit] = useState(false);
  const [mapBounds, setMapBounds] = useState<MapRect>();
  const [hasMap, setHasMap] = useState(false);
  // ADR-0218: kartfilens sha256, så att förhandsvisningen hämtar filen ur webbläsarens lager som banläggningen.
  const [mapSha256, setMapSha256] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [eachVariant, setEachVariant] = useState(false);
  const [header, setHeader] = useState(false);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [fill, setFill] = useState<"FILL" | "REPEAT">("FILL");
  const [profileId, setProfileId] = useState<string>();
  const [order, setOrder] = useState<"BUNDLE" | "START">("BUNDLE");
  // ADR-0213: baksidan (ingen, dubbelsidigt i samma PDF, separat körning) och vilka löpare som skrivs ut.
  const [backMode, setBackMode] = useState<BackMode>("NONE");
  const duplex = backMode === "DUPLEX";
  const [selection, setSelection] = useState<RunnerSelection>(ALL_RUNNERS);
  // Träningsläget (ADR-0192): kartbitar och kontrollantens karta i linjeorienteringen.
  const [pieces, setPieces] = useState(false);
  const [controllerMaps, setControllerMaps] = useState(false);
  // ADR-0217 beslut 8: layouten för "alla ark i en layout", klasserna och antalet.
  const [printLayout, setPrintLayout] = useState(MAIN_LAYOUT);
  const [count, setCount] = useState<PrintCount>({ kind: "OWN", copies: 1 });
  const [chosenClasses, setChosenClasses] = useState<string[]>([]);
  // Senaste versionen för nästa sparande (inte den som fanns när knappen ritades).
  const versionRef = useRef<number>(undefined);
  const serial = useMemo(() => serialSaves(), []);
  const load = useCallback(async (first = false) => {
    setFailed(false);
    try {
      const state = await fetchCourseSetting(raceId);
      const next = (state.setting?.document ?? null) as unknown as CourseSettingDocument | null;
      setDocument(next);
      versionRef.current = state.setting?.version;
      setCanEdit(state.access.level === "EDIT");
      setHasMap(state.mapFile !== null); setMapSha256(state.mapFile?.sha256);
      if (state.mapFile?.bounds) setMapBounds(state.mapFile.bounds);
      if (next && first) {
        const wanted = new URLSearchParams(window.location.search).get("course");
        setChosen(wanted && (wanted === ALL_CONTROLS || next.courses.some(course => course.id === wanted)) ? [wanted]
          : [...next.courses].sort((a, b) => a.order - b.order).map(course => course.id));
      }
    } catch { setFailed(true); }
  }, [raceId]);
  useEffect(() => { void load(true); }, [load]);

  // Kartfilen i en Worker; sidornas bilder ritas en i taget (gemensamt med Layout).
  const map = usePrintMap(raceId, hasMap && (mapSha256 ?? true), bounds => setMapBounds(current => current ?? bounds));
  const { session, mapState, colors, usage, mapScale, renderImage } = map;

  // Kartbuntarna (steg 61) när en karta per löpare skrivs ut.
  const [bundles, setBundles] = useState<MapBundleResponse>();
  const [bundlesState, setBundlesState] = useState<"none" | "reading" | "ready" | "failed">("none");
  useEffect(() => {
    // Kartbuntarna behövs för löparna, klasserna, antalet och layouternas klasser (ADR-0217).
    if ((mode === "COURSES" && count.kind === "OWN" && printLayout === MAIN_LAYOUT) || bundlesState !== "none") return;
    setBundlesState("reading");
    fetchMapBundles(raceId).then(data => { setBundles(data); setBundlesState("ready"); }, () => setBundlesState("failed"));
  }, [mode, bundlesState, raceId, count.kind, printLayout]);

  /**
   * Sparar en ändring i taget, alltid på senaste versionen (`saveOnLatest`). Ägarens fel 2026-11-03 ("Godkänd" sparades inte):
   * två sparanden i följd (profilen vald, sedan Godta) gick på samma gamla version och servern avvisade det andra. Avvisat:
   * läs om och försök en gång till, tyst; går det ändå inte är svaret false och den som sparade visar det.
   */
  const save = useCallback((edits: CourseSettingEdit[]): Promise<boolean> => serial(async () => {
    let attempts = 0;
    const result = await saveOnLatest({
      // Första försöket på versionen som sidan läste senast; ett nytt försök läser om först.
      latest: async () => { if (attempts++ > 0 || versionRef.current === undefined) await load(); return versionRef.current; },
      attempt: async baseVersion => {
        const result = await saveCourseSettingEdits(raceId, { formatVersion: 1, requestId: crypto.randomUUID(), baseVersion,
          edits: edits as unknown as CourseSettingEditsRequest["edits"] });
        await load();
        if (result.rejected.length === 0) return "saved";
        // Ett nytt försök följer; misslyckas det visas det på sidan (inte ett fel i konsolen, som dev-överlägget räknar).
        console.warn("Utskriftsinställningen avvisades", result.rejected);
        return "conflict";
      }
    });
    return result.saved;
  }), [raceId, load, serial]);
  // Sparanden som ingen panel svarar på (profilen som väljs, beskrivningen som dras på arket): en rad med Försök igen.
  const [unsaved, setUnsaved] = useState<CourseSettingEdit[]>();
  const saveShown = useCallback(async (edits: CourseSettingEdit[]) => {
    const ok = await save(edits);
    setUnsaved(ok ? undefined : edits);
    return ok;
  }, [save]);

  // ADR-0217 (fas 3): papperet redigeras i Layout; här bara vad, antal, färger och PDF/skrivare.
  const document = loaded;

  // Ringklippen över detaljer (ADR-0211 beslut 1): samma gap som i editorn, räknade av kartans Worker. Saknades förut, så
  // förhandsvisningen och PDF:en ritade hela ringar där editorn visade avbrott.
  const mapAids = useDetailGaps(session, document).options;

  const standard = document?.event.descriptionStandard ?? "2018";
  const symbols = useMemo(() => {
    try { return symbolLookup(descriptionSymbols(standard)); } catch (error) { console.error("Symbolerna misslyckades", error); return symbolLookup([] as DescriptionSymbol[]); }
  }, [standard]);
  const courses = useMemo(() => [...(document?.courses ?? [])].sort((a, b) => a.order - b.order), [document]);

  // Utskriftsprofilen: vald här, annars tävlingens, annars kartans egna färger i normens ordning (ADR-0215 beslut 1).
  const printColors = usePrintColors(document, profileId, map);
  const { savedProfiles, profile, pressLayers, pressNorm, colorsKey, courseColor } = printColors;
  function chooseProfile(wanted: string) {
    // En BL-profil som redan godkänts för tävlingen: välj kopian med besluten.
    const id = savedProfiles.find(item => item.basedOn === wanted && item.reference)?.id ?? wanted;
    setProfileId(id);
    if (canEdit && id !== document?.event.printProfileId) void saveShown([{ type: "SET_EVENT", changes: { printProfileId: id } }]);
  }

  // ADR-0217 (fas 3): "Kartor per ark" väljs i Layout (huvudlayoutens); en karta per löpare utan sådan får en karta per A4.
  const mainTemplate = document ? sheetLayoutOfLayout(document, MAIN_LAYOUT) : undefined;
  const template = mode === "RUNNERS" ? mainTemplate ?? BUILT_IN_SHEET_LAYOUTS.find(item => item.id === (duplex ? "a4-one" : "a4-strip")) : mainTemplate;

  const runners = useMemo<RunnerPrint | undefined>(() => document && bundles
    ? runnerPrintItems(document, bundles, clockIn(bundles.timeZone), order) : undefined, [document, bundles, order]);

  // Kartorna i banläget (samma som arken nedan) för PDF:en.
  // Översynen 2026-11-02: en bana vars varianter inte går att räkna hoppas inte tyst över (felet visas med de andra).
  const { courseItems, variantErrors } = useMemo(() => {
    let items: SheetItem[] = [];
    const failed: string[] = [];
    if (!document) return { courseItems: items, variantErrors: failed };
    if (mode === "CLASSES") items = safely("Klassernas kartor", () => classItems(document, bundles, chosenClasses, count), () => []);
    else if (mode === "PROOF") items = safely("Provarken", () => proofItems(document, bundles), () => []);
    else for (const course of [ALL_CONTROLS, ...courses.map(item => item.id)].filter(id => chosen.includes(id))) {
      try {
        items.push(...layoutItems(document, printLayout, [course], eachVariant, bundles));
      } catch (error) {
        console.error("Varianterna misslyckades", error);
        failed.push(course === ALL_CONTROLS ? text.print.allControls : courses.find(item => item.id === course)?.name ?? course);
      }
    }
    // Antalet (ADR-0217): varje karta i följd så många gånger som antalet säger (klasserna har redan sitt).
    if (mode === "COURSES" && !(count.kind === "OWN" && count.copies === 1)) items = withCopies(document, bundles, items, count);
    // Stjärnans uddar, kepsens kartor och kontrollantens karta (ADR-0192 beslut 6).
    const expanded = safely("Träningens kartor", () => expandTrainingItems(document, items, { controllerMaps }), () => items);
    // Kartbyten (ADR-0203): varje del på ett eget ark.
    const parted = safely("Banans delar", () => expandPartItems(document, expanded), () => expanded);
    return { courseItems: parted, variantErrors: failed };
  }, [document, courses, chosen, eachVariant, controllerMaps, mode, bundles, chosenClasses, count, printLayout]);
  const trainingChosen = useMemo(() => document ? chosen.filter(id => document.training?.courses[id]) : [], [document, chosen]);
  // Kartbyten (ADR-0203): "Dubbelsidigt" lägger del 2 på baksidan av del 1; förval på när en vald bana vänder kartan (map-flip).
  const withParts = courseItems.some(item => item.part !== undefined);
  const flips = useMemo(() => document ? courseItems.some(item => item.part !== undefined && item.part > 0 && safely("Kartbytet", () => {
    const after = exchangeAfterPart(document, item.course, item.part! - 1, item.variant);
    return after !== undefined && isFlip(document, after);
  }, () => false)) : false, [document, courseItems]);
  const [partsDuplexChoice, setPartsDuplex] = useState<boolean>();
  const partsDuplex = withParts && !template && (partsDuplexChoice ?? flips);
  const lineChosen = trainingChosen.some(id => document?.training?.courses[id]?.line);

  // Arken som servern också lägger ut för PDF:en (`printSheetGroups` i paketet), med etikett per ark och vad som inte gick.
  const chosenRunners = useMemo(() => runners ? selectRunnerItems(runners.items, selection) : [], [runners, selection]);
  const { sheets, errors, perItem } = useMemo(() => {
    const out: Printed[] = [], bad: string[] = mode === "RUNNERS" ? [] : [...variantErrors];
    if (!document) return { sheets: out, errors: bad, perItem: [] as number[] };
    const runnerMode = mode === "RUNNERS";
    if (runnerMode && (!runners || !template)) return { sheets: out, errors: bad, perItem: [] as number[] };
    const items: readonly SheetItem[] = runnerMode ? chosenRunners : courseItems;
    const perItem = items.map(() => 0);
    const nameOf = (course: string) => course === ALL_CONTROLS ? text.print.allControls : courses.find(item => item.id === course)?.name ?? course;
    const layout = !runnerMode && pieces ? { kind: "PIECES" as const }
      : template ? { kind: "TEMPLATE" as const, template, perRunner: runnerMode, duplex, fill, ...(runnerMode && !mainTemplate ? { ownPage: true } : {}) }
        : { kind: "COURSE" as const, header, duplex: partsDuplex };
    // ADR-0213: banornas förhandsvisning visar löparens variabler som platshållare ({namn} …).
    const groups = printSheetGroups(document, layout, items, { mapBounds, ...(bundles ? { date: bundles.raceDate } : {}), ...mapAids, runnerPlaceholders: !runnerMode,
      onError: ({ item, error }) => {
        console.error("Utskriftslayouten misslyckades", error);
        const row = item === undefined ? undefined : items[item];
        bad.push(!row ? template?.name ?? "" : runnerMode ? row.runner?.name ?? row.course : nameOf(row.course));
      } });
    for (const group of groups) {
      const row = group.item === undefined ? undefined : items[group.item];
      if (group.item !== undefined) perItem[group.item] = group.sheets.length;
      group.sheets.forEach((sheet, part) => {
        const page = group.pages?.[part];
        // Kartbytets del hör till nyckeln: utan den fick en banas två delar samma nyckel (dev-överläggets "1 Issue").
        // ADR-0217: layouten och kartans plats (antalet ger samma karta flera gånger) hör också till nyckeln.
        if (page && row) out.push({ key: `${row.course}|${row.variant ?? ""}|${row.part ?? ""}|${JSON.stringify(row.training ?? {})}|${row.layout ?? ""}|${group.item}|${page.sheet}`, sheet,
          label: text.page.sheet(page.title, page.sheet, page.sheets) });
        // En löpare per ark: remsan och baksidan gäller arkets löpare.
        else if (runnerMode && row) out.push({ key: `r${group.item}|${part}`, sheet,
          label: [sheet.frames[0]?.title ?? "", row.runner?.name ?? row.runner?.kind ?? ""].filter(Boolean).join(" – ") });
        else out.push({ key: `t${group.item ?? ""}|${part}`, sheet, label: sheet.frames.length === 0 ? text.page.blankBack : sheet.frames.map(frame => frame.title).join(", ") });
      });
    }
    return { sheets: out, errors: bad, perItem };
  }, [document, courses, courseItems, variantErrors, header, mapBounds, mode, template, fill, runners, chosenRunners, duplex, bundles, pieces, partsDuplex, mapAids]);

  const images = useSheetImages(map, sheets, printColors);
  // Löparens ark ur kontrolltabellen (ADR-0213): markerat bland arken.
  const [openKey, setOpenKey] = useState<string>();

  const toggle = (id: string, on: boolean) => setChosen(current => on ? [...current, id] : current.filter(item => item !== id));
  const allIds = [ALL_CONTROLS, ...courses.map(course => course.id)];
  const back = <Link className={styles.back} href={`/admin/${raceId}/course-setting`}>{text.page.back}</Link>;
  if (failed) return <main className={styles.page}><div className={styles.controls}>{back}<Notice tone="error" role="alert"><p>{text.page.failed}</p>
    <div><Button variant="secondary" onClick={() => void load(true)}>{text.page.retry}</Button></div></Notice></div></main>;
  if (document === undefined) return <main className={styles.page}><div className={styles.controls}>{back}<p role="status">{text.page.loading}</p></div></main>;
  if (document === null) return <main className={styles.page}><div className={styles.controls}>{back}<p>{text.page.noSetting}</p></div></main>;
  const frameCount = sheets.reduce((sum, item) => sum + item.sheet.frames.length, 0);
  const waiting = mapState === "reading" || (mapState === "ready" && sheets.some(item => item.sheet.frames.some(frame => !images[frameImageKey(frame, colorsKey)])));
  // Hela utskriften stoppas av felen mot Kartor till starten; ett urval (en löpare som skrivs om) varnas bara i tabellen.
  const blocked = mode === "RUNNERS" && selection.kind === "ALL" && (runners?.problems.length ?? 0) > 0;
  const checkRows: CheckRow[] = mode === "RUNNERS" && runners && bundles ? runnerCheckRows(runners, chosenRunners, runnerPages(perItem),
    course => courses.find(item => item.id === course)?.name ?? course, selection.kind === "ALL" ? bundles.missingVariant : [], runnerText) : [];
  const previewRow = (row: CheckRow) => {
    if (row.item === undefined) return;
    const key = `r${row.item}|0`;
    setOpenKey(key);
    const index = sheets.findIndex(item => item.key === key);
    window.document.getElementById(`print-sheet-${index}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const runnerMode = mode === "RUNNERS";
  const shownPaper = readOnlyPaper(sha => paperImageUrl(raceId, sha));
  const saveProfile = async (edits: CourseSettingEdit[]) => { const ok = await save(edits); if (ok) setProfileId(undefined); return ok; };
  const blPanel = { profile, builtIn: BUILT_IN_PRINT_PROFILES, colors, usage, readOnly: !canEdit, frame: sheets[0]?.sheet.frames[0], symbols, render: renderImage,
    norm: pressNorm, onSave: saveProfile };
  return <main className={styles.page}>
    <style>{pageStyles(sheets.map(item => item.sheet))}</style>
    <div className={styles.controls}>
      <div className={styles.topLine}>{back}<CourseSettingTabs raceId={raceId} current="PRINT" /><HelpButton view={["CS_PRINT_PAGE", "CS_PRINT", "COURSE_SETTING"]} /><AccountMenu /></div>
      <h1>{text.page.title}</h1>
      {/* ADR-0215: färgerna som en statusrad med två lägen; hela flödet (ADR-0211 beslut 6) under Avancerat. */}
      <PrintColors saved={savedProfiles} profile={profile} colors={colors} usage={usage} norm={pressNorm} detectedNorm={pressNormOf({}, mapScale, usage)}
        layers={pressLayers} readOnly={!canEdit} onSelect={chooseProfile} onSave={saveProfile}
        cards={profile.reference && hasMap ? <BlProposalPanel key={profile.basedOn ?? profile.id} {...blPanel} /> : undefined}
        doubtful={profile.reference && hasMap ? <BlProposalPanel key={`${profile.basedOn ?? profile.id}-tveksamma`} {...blPanel} variant="DOUBTFUL" /> : undefined} />
      {/* ADR-0211 beslut 7: vad som skrivs ut och de två sätten att skriva ut, bredvid varandra. */}
      <section className={styles.panel} aria-labelledby="print-output" data-testid="print-output">
        <h2 id="print-output">{outputText.heading} <HelpLink article="utskrift" view={["CS_PRINT_PAGE", "CS_PRINT"]} /></h2>
        <div className={styles.row} role="radiogroup" aria-label={text.page.mode}>
          <label className={styles.check}><input type="radio" name="print-mode" checked={mode === "COURSES"} onChange={() => { setMode("COURSES") }} />
            {text.page.modeCourses}</label>
          <label className={styles.check}><input type="radio" name="print-mode" checked={runnerMode} onChange={() => { setMode("RUNNERS") }}
            data-testid="print-mode-runners" />{text.page.modeRunners}</label>
          <label className={styles.check}><input type="radio" name="print-mode" checked={mode === "CLASSES"} onChange={() => { setMode("CLASSES") }}
            data-testid="print-mode-classes" />{whatText.modeClasses}</label>
          <label className={styles.check}><input type="radio" name="print-mode" checked={mode === "PROOF"} onChange={() => { setMode("PROOF") }}
            data-testid="print-mode-proof" />{whatText.modeProof}</label>
        </div>
        {mode !== "RUNNERS" && <PrintWhat raceId={raceId} mode={mode} entries={layoutEntries(document, layoutText.mainName)} layout={printLayout} onLayout={setPrintLayout}
          count={count} onCount={setCount} classes={[...new Set((bundles?.classes ?? []).map(row => row.name))]} chosenClasses={chosenClasses} onClasses={setChosenClasses} />}
        {mode === "CLASSES" || mode === "PROOF" ? null : mode === "COURSES" ? <>
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
            {trainingChosen.length > 0 && <label className={styles.check}><input type="checkbox" checked={pieces} data-testid="print-pieces"
              onChange={event => setPieces(event.target.checked)} />{trainingText.print.pieces}</label>}
            {withParts && !template && <label className={styles.check}><input type="checkbox" checked={partsDuplex} data-testid="print-parts-duplex"
              onChange={event => setPartsDuplex(event.target.checked)} />{text.page.partsDuplex}</label>}
            {lineChosen && <label className={styles.check}><input type="checkbox" checked={controllerMaps} data-testid="print-controller"
              onChange={event => setControllerMaps(event.target.checked)} />{trainingText.print.controller}</label>}
            {template && template.frames.length > 1 && <label className={styles.field}>{sheetLayoutText.mode}
              <select value={fill} onChange={event => setFill(event.target.value as "FILL" | "REPEAT")} data-testid="print-fill">
                <option value="FILL">{text.page.fill}</option><option value="REPEAT">{text.page.repeat}</option></select></label>}
          </div>
        </> : <RunnerControls bundlesState={bundlesState} runners={runners} raceId={raceId} order={order} setOrder={setOrder} backMode={backMode} setBackMode={setBackMode}
          selection={selection} setSelection={setSelection} chosen={chosenRunners.length} />}
        <span role="status" data-testid="print-count">{sheets.length === 0 ? text.page.none : frameCount > sheets.length ? `${text.page.sheets(sheets.length)}, ${sheetLayoutText.frames(frameCount)}`
          : text.page.pages(sheets.length)}{waiting ? ` – ${text.page.readingMap}` : ""}</span>
        {blocked && <span className={styles.muted}>{text.page.runnerProblems}</span>}
        <div className={styles.outputs}>
          <div className={styles.stack} data-testid="print-output-printer">
            <Button onClick={() => window.print()} disabled={sheets.length === 0}>{outputText.printer}</Button>
            <p className={styles.muted} data-testid="print-draft">{outputText.printerHelp}</p>
          </div>
          <PdfPanel raceId={raceId} profile={profile} colors={colors} usage={usage} disabled={sheets.length === 0 || blocked || errors.length > 0}
            blockedText={blocked ? pdfText.runnerBlocked : undefined} heading={outputText.pdf} help={outputText.pdfHelp}
            selection={{ items: mode === "RUNNERS" ? chosenRunners.map(withoutEntry) : courseItems, template, templateIsDraft: false,
              savedTemplateIds: (document.event.layoutTemplates ?? []).map(item => item.id), header, fill, perRunner: mode === "RUNNERS", duplex: mode === "RUNNERS" ? duplex : partsDuplex,
              ...(mode === "RUNNERS" && !mainTemplate ? { ownPage: true } : {}),
              pieces: mode === "COURSES" && pieces,
              ...(bundles ? { date: bundles.raceDate } : {}) }} />
        </div>
      </section>
      {unsaved && <SaveFailed onRetry={() => void saveShown(unsaved)} />}
      {!hasMap && <p className={styles.muted}>{text.page.noMap}</p>}
      {mapState === "failed" && <Notice tone="attention">{text.page.mapFailed}</Notice>}
      {errors.map(name => <Notice key={name} tone="error">{text.page.failedCourse(name)}</Notice>)}
      {runnerMode && runners && <RunnerCheckTable rows={checkRows} onPreview={previewRow} selected={undefined} />}
    </div>
    {/* Arken som skrivs ut (förhandsvisningen); papperet redigeras i Layout (ADR-0217 fas 3). */}
    <section className={styles.editor} aria-label={outputText.preview} data-testid="print-preview">
      <div className={styles.sheets}>
        {sheets.map((item, index) => <div key={item.key} id={`print-sheet-${index}`} className={styles.sheetSlot} data-open={openKey === item.key ? "" : undefined}>
          <SheetView sheet={item.sheet} index={index} symbols={symbols} images={images} colorsKey={colorsKey}
            courseColor={courseColor} label={item.label} pressLayers={pressLayers} paper={shownPaper} /></div>)}
      </div>
    </section>
  </main>;
}
