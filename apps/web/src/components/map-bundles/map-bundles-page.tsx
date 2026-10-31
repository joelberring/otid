"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { MapBundleResponse, MapBundleRowDto, MapPrintList, MapReserveDto } from "@o-tid/contracts";
import { mapBackPages, mapBundlesByClass, mapBundlesByTime } from "@o-tid/domain";
import { mapBundlesSv as text } from "../../i18n/map-bundles-sv";
import { formatClockTime } from "../../lib/clock-time";
import { toCsv } from "../../lib/lists/csv";
import { fetchMapBundles, recordMapPrint, saveMapReserve } from "../../lib/map-bundles-client";
import { download } from "../lists/list-frame";
import { BackSheet, backPageCss, DEFAULT_BACK_SETTINGS, type BackSettings } from "./map-back-pages";
import styles from "./map-bundles.module.css";

/**
 * Kartor till starten (PLAN.md steg 61): tryckantal per variant, kartbuntslistan (A4 och CSV) och baksidor per löpare.
 * Allt kommer ur samma plan från servern (domänens `planMapBundles`), så ordningen och räkningen är densamma i alla tre.
 * Kartorna trycks fortfarande i Purple Pen eller OCAD.
 */
type View = "COUNTS" | "BUNDLE" | "BACKS";
type Order = "TIME" | "CLASS";
type Printing = "BUNDLE" | "BACKS" | "TEST";
const PAGE_STYLE_ID = "otid-map-page";
const SETTINGS_KEY = "otid-map-backs";

function short(instant: string | null, timeZone: string): string {
  if (!instant) return text.freeStart;
  const full = formatClockTime(instant, timeZone);
  return full.endsWith(":00") ? full.slice(0, 5) : full;
}

function readSettings(): BackSettings {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<BackSettings> | null;
    return { ...DEFAULT_BACK_SETTINGS, ...(value ?? {}) };
  } catch { return DEFAULT_BACK_SETTINGS; }
}

export function MapBundlesPage({ raceId }: { raceId: string }) {
  const [data, setData] = useState<MapBundleResponse>();
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>("COUNTS");
  const [order, setOrder] = useState<Order>();
  const [message, setMessage] = useState("");
  const [printing, setPrinting] = useState<Printing>();
  const [settings, setSettings] = useState<BackSettings>(DEFAULT_BACK_SETTINGS);
  const load = useCallback(async () => {
    setFailed(false);
    try { setData(await fetchMapBundles(raceId)); } catch { setFailed(true); }
  }, [raceId]);
  useEffect(() => { void load(); setSettings(readSettings()); }, [load]);
  useEffect(() => {
    const after = () => setPrinting(undefined);
    window.addEventListener("afterprint", after);
    return () => window.removeEventListener("afterprint", after);
  }, []);
  // Utskriften: rätt pappersformat och bara den valda delen; webbläsarens utskrift öppnas när sidan har ritats.
  useEffect(() => {
    if (!printing) return;
    let style = document.getElementById(PAGE_STYLE_ID);
    if (!style) { style = document.createElement("style"); style.id = PAGE_STYLE_ID; document.head.append(style); }
    style.textContent = printing === "BUNDLE" ? "@page { size: A4; margin: 12mm; }" : backPageCss(settings);
    const timer = setTimeout(() => window.print(), 50);
    return () => clearTimeout(timer);
  }, [printing, settings]);

  const timeZone = data?.timeZone ?? "UTC";
  const clock = (instant: string | null) => short(instant, timeZone);
  const massOnly = !!data && data.classes.length > 0 && data.classes.every(row => row.startMode === "MASS");
  const chosenOrder: Order = order ?? (massOnly ? "CLASS" : "TIME");
  const pages = useMemo(() => data ? mapBackPages(data.groups) : [], [data]);

  async function print(list: MapPrintList, kind: Printing) {
    if (!data) return;
    setMessage("");
    try {
      const outcome = await recordMapPrint(raceId, list, data.stateHash);
      if (outcome === "conflict") { await load(); setMessage(text.printChanged); return; }
      await load();
      setPrinting(kind);
    } catch { setMessage(text.printError); }
  }
  function changeSettings(patch: Partial<BackSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* Inställningen gäller ändå på sidan. */ }
  }

  if (failed) return <main className={styles.page}><p role="alert">{text.loadError}</p>
    <div><button type="button" onClick={() => void load()}>{text.retry}</button></div></main>;
  if (!data) return <main className={styles.page}><p role="status">{text.loading}</p></main>;
  const race = `${data.eventName} · ${data.raceName} · ${data.raceDate}`;
  return <main className={styles.page} data-printing={printing}>
    <header className={`${styles.head} ${styles.noPrint}`}>
      <Link className={styles.back} href={`/admin/${raceId}/manage`}>{text.back}</Link>
      <h1>{text.title}</h1>
      <p>{race}</p>
      <p>{text.pageHelp}</p>
    </header>
    <div className={`${styles.tabs} ${styles.noPrint}`} role="group" aria-label={text.title}>
      {(["COUNTS", "BUNDLE", "BACKS"] as const).map(id => <button key={id} type="button" aria-pressed={view === id}
        onClick={() => setView(id)}>{text.views[id]}</button>)}
    </div>
    {message && <p role="alert" className={`${styles.notice} ${styles.noPrint}`}>{message}</p>}
    {data.missingVariant.length > 0 && <div className={`${styles.notice} ${styles.noPrint}`} role="note">
      <strong>{text.missingVariantTitle(data.missingVariant.length)}</strong>
      <p>{data.missingVariant.slice(0, 12).map(row => `${row.name} (${row.className})`).join(", ")}{data.missingVariant.length > 12 ? " …" : ""}</p>
      <p>{text.missingVariantHelp}</p>
    </div>}
    {view === "COUNTS" && <Counts data={data} raceId={raceId} onSaved={load} />}
    {view === "BUNDLE" && <section className={styles.section} aria-labelledby="map-bundle-title">
      <h2 id="map-bundle-title" className={styles.noPrint}>{text.bundleTitle}</h2>
      <PrintStatus print={data.prints.BUNDLE} clock={instant => formatClockTime(instant, timeZone).slice(0, 5)} />
      <p className={`${styles.help} ${styles.noPrint}`}>{text.bundleHelp}</p>
      <div className={`${styles.tools} ${styles.noPrint}`}>
        <label>{text.orderLabel}<select value={chosenOrder} onChange={event => setOrder(event.target.value as Order)}>
          {(["TIME", "CLASS"] as const).map(id => <option key={id} value={id}>{text.order[id]}</option>)}</select></label>
        <button type="button" onClick={() => void print("BUNDLE", "BUNDLE")}>{text.printList}</button>
        <button type="button" className="secondary" onClick={() => download(`${text.csvFile}-${data.raceDate}.csv`,
          bundleCsv(orderedRows(data, chosenOrder), clock), "text/csv;charset=utf-8")}>{text.csv}</button>
      </div>
      <header className={styles.printHeader}><h2>{text.bundleTitle} · {text.order[chosenOrder]}</h2><p>{race}</p>
        {data.prints.BUNDLE && <p>{text.printedAt(formatClockTime(data.prints.BUNDLE.printedAt, timeZone).slice(0, 5))}</p>}</header>
      <BundleTable data={data} order={chosenOrder} clock={clock} />
    </section>}
    {view === "BACKS" && <section className={`${styles.section} ${styles.noPrint}`} aria-labelledby="map-backs-title">
      <h2 id="map-backs-title">{text.backsTitle}</h2>
      <PrintStatus print={data.prints.BACKS} clock={instant => formatClockTime(instant, timeZone).slice(0, 5)} />
      <p className={styles.help}>{text.backsHelp}</p>
      <div className={styles.tools}>
        <label>{text.paper}<select value={settings.paper} onChange={event => changeSettings({ paper: event.target.value as BackSettings["paper"] })}>
          {(["A4", "A3"] as const).map(id => <option key={id} value={id}>{text.papers[id]}</option>)}</select></label>
        <label>{text.orientation}<select value={settings.orientation}
          onChange={event => changeSettings({ orientation: event.target.value as BackSettings["orientation"] })}>
          {(["portrait", "landscape"] as const).map(id => <option key={id} value={id}>{text.orientations[id]}</option>)}</select></label>
        <label>{text.position}<select value={settings.position} onChange={event => changeSettings({ position: event.target.value as BackSettings["position"] })}>
          {(["TOP_LEFT", "TOP_RIGHT", "CENTER", "BOTTOM_LEFT", "BOTTOM_RIGHT"] as const).map(id =>
            <option key={id} value={id}>{text.positions[id]}</option>)}</select></label>
        <label className={styles.check}><input type="checkbox" checked={settings.mirror} onChange={event => changeSettings({ mirror: event.target.checked })} />
          {text.mirror}</label>
      </div>
      <div className={styles.tools}>
        <button type="button" className="secondary" onClick={() => setPrinting("TEST")}>{text.testPage}</button>
        <button type="button" disabled={pages.length === 0} onClick={() => void print("BACKS", "BACKS")}>{text.printBacks}</button>
        <span className={styles.muted} data-testid="map-back-count">{text.pages(pages.filter(page => page.kind !== "DIVIDER").length)}</span>
      </div>
      <div className={styles.preview} aria-hidden="true">
        {pages.slice(0, 8).map((page, index) => <div key={index} className={styles.previewSheet}>
          <BackSheet page={page} settings={settings} clock={clock} /></div>)}
      </div>
    </section>}
    {(printing === "BACKS" || printing === "TEST") && <div className={styles.printPages} data-testid="map-back-print">
      {printing === "TEST" ? <BackSheet page="TEST" settings={settings} clock={clock} />
        : pages.map((page, index) => <BackSheet key={index} page={page} settings={settings} clock={clock} />)}
    </div>}
  </main>;
}

function PrintStatus({ print, clock }: { print: MapBundleResponse["prints"]["BUNDLE"]; clock: (instant: string) => string }) {
  if (!print) return <p className={`${styles.muted} ${styles.noPrint}`}>{text.notPrinted}</p>;
  const time = clock(print.printedAt);
  if (print.changes.length === 0) return <p className={`${styles.ok} ${styles.noPrint}`} role="status">{text.noChanges(time)}</p>;
  return <div className={`${styles.notice} ${styles.noPrint}`} role="status" data-testid="map-print-changes">
    <strong>{text.changesSince(print.changes.length, time)}</strong>
    <ul>{print.changes.slice(0, 30).map((change, index) => <li key={index}>{text.change(change, value => value ?? "–")}</li>)}</ul>
  </div>;
}

function Counts({ data, raceId, onSaved }: { data: MapBundleResponse; raceId: string; onSaved: () => Promise<void> }) {
  const [kind, setKind] = useState<MapReserveDto["kind"]>(data.reserve.kind);
  const [value, setValue] = useState(String(data.reserve.value));
  const [status, setStatus] = useState("");
  async function save() {
    const number = Number(value);
    if (!/^\d{1,4}$/.test(value) || number > 1000) { setStatus(text.reserveInvalid); return; }
    try { await saveMapReserve(raceId, { kind, value: number }); await onSaved(); setStatus(text.reserveSaved); }
    catch { setStatus(text.reserveError); }
  }
  const total = data.groups.reduce((sum, group) => sum + group.printCount, 0);
  return <section className={styles.section} aria-labelledby="map-counts-title">
    <h2 id="map-counts-title">{text.countsTitle}</h2>
    <p className={styles.help}>{text.countsHelp}</p>
    <form className={`${styles.tools} ${styles.noPrint}`} onSubmit={event => { event.preventDefault(); void save(); }}>
      <label>{text.reserve}<input type="number" min={0} max={1000} inputMode="numeric" value={value}
        onChange={event => setValue(event.target.value)} /></label>
      <label><span className={styles.muted}>&nbsp;</span><select aria-label={text.reserve} value={kind}
        onChange={event => setKind(event.target.value as MapReserveDto["kind"])}>
        {(["PERCENT", "COUNT"] as const).map(id => <option key={id} value={id}>{text.reserveKinds[id]}</option>)}</select></label>
      <button type="submit" className="secondary">{text.reserveSave}</button>
      {status && <span role="status">{status}</span>}
    </form>
    <div className={styles.tableScroll}><table className={styles.table} aria-label={text.countsTitle}>
      <thead><tr><th scope="col">{text.course}</th><th scope="col">{text.variant}</th><th scope="col" className={styles.num}>{text.runners}</th>
        <th scope="col" className={styles.num}>{text.vacancies}</th><th scope="col" className={styles.num}>{text.reserveColumn}</th>
        <th scope="col" className={styles.num}>{text.print}</th></tr></thead>
      <tbody>{data.groups.map(group => <tr key={`${group.courseName}-${group.variantCode ?? ""}`}>
        <th scope="row">{group.courseName}</th><td className={styles.code}>{group.variantCode ?? text.noVariant}</td>
        <td className={styles.num}>{group.runnerCount}</td><td className={styles.num}>{group.vacancyCount}</td>
        <td className={styles.num}>{group.reserveCount}</td><td className={`${styles.num} ${styles.code}`}>{group.printCount}</td>
      </tr>)}</tbody>
      <tfoot><tr><th scope="row" colSpan={5}>{text.total}</th><td className={`${styles.num} ${styles.code}`}>{total}</td></tr></tfoot>
    </table></div>
  </section>;
}

function orderedRows(data: MapBundleResponse, order: Order): MapBundleRowDto[] {
  if (order === "TIME") return data.rows;
  const variants = new Map(data.classes.map(row => [row.name, row.variantCodes]));
  return mapBundlesByClass(data.rows, name => variants.get(name) ?? []).flatMap(group => group.rows);
}

function bundleCsv(rows: readonly MapBundleRowDto[], clock: (instant: string | null) => string): string {
  return toCsv(text.csvHeader, rows.map(row => [row.number, row.startMode === "FREE" ? text.freeStart : clock(row.startTime), row.className,
    row.courseName, row.variantCode ?? "", row.name ?? text.vacant, row.club ?? ""]));
}

function BundleTable({ data, order, clock }: { data: MapBundleResponse; order: Order; clock: (instant: string | null) => string }) {
  if (data.rows.length === 0) return <p>{text.bundleEmpty}</p>;
  const variants = new Map(data.classes.map(row => [row.name, row.variantCodes]));
  const groups = order === "TIME"
    ? mapBundlesByTime(data.rows).map(group => ({ key: `${group.startTime}-${group.rows[0]!.classId}`,
      title: group.startTime ? clock(group.startTime) : `${text.freeStart} · ${group.rows[0]!.className}`, rows: group.rows }))
    : mapBundlesByClass(data.rows, name => variants.get(name) ?? []).map(group => ({ key: `${group.className}-${group.variantCode}`,
      title: `${group.className}${group.variantCode ? ` · ${group.variantCode}` : ""} · ${group.rows.length}`, rows: group.rows }));
  return <div className={styles.tableScroll}><table className={styles.table} aria-label={text.bundleTitle} data-testid="map-bundle-list">
    <thead><tr><th scope="col" className={styles.num}>{text.number}</th><th scope="col">{text.startTime}</th><th scope="col">{text.className}</th>
      <th scope="col">{text.variant}</th><th scope="col">{text.name}</th><th scope="col">{text.club}</th></tr></thead>
    {groups.map(group => <tbody key={group.key}>
      <tr className={styles.groupHead}><th scope="rowgroup" colSpan={6}>{group.title}</th></tr>
      {group.rows.map(row => <tr key={row.number}>
        <td className={styles.num}>{row.number}</td><td>{row.startMode === "FREE" ? text.freeStart : clock(row.startTime)}</td>
        <td>{row.className}</td><td className={styles.code}>{row.variantCode ?? ""}</td>
        <td>{row.name ?? <span className={styles.muted}>{text.vacant}</span>}</td><td>{row.club ?? ""}</td>
      </tr>)}
    </tbody>)}
  </table></div>;
}
