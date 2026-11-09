"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { printColorsEn } from "../../i18n/course-setting-print-more-en";
import { useTexts } from "../language-provider";
import {
  BUILT_IN_PRINT_PROFILES, cmykToCss, colorPreflight, decisionFor, MAP_OWN_PRINT_PROFILE_ID, mapColorAdjust, parsePrintProfile, referenceRow, sourceMapColors,
  SUPERSEDED_PRINT_PROFILES, type Cmyk100, type CourseSettingEdit, type PressNorm, type PrintProfile
} from "@o-tid/course-setting";
import type { ColorUsage, MapColor } from "@o-tid/map-file";
import { printColorsSv } from "../../i18n/course-setting-print-colors-sv";
import { downloadText } from "../../lib/course-setting-api";
import { approvalEdits, proposalState } from "../../lib/course-setting-bl-proposal";
import { blProfileIdFor, colorModeOf, colorSummary, usedColors } from "../../lib/course-setting-print-colors-mode";
import { parseCmyk, rowFor, withColorRow } from "../../lib/course-setting-print-settings";
import type { PressLayers } from "../../lib/course-setting-press-layers";
import { Button, Notice } from "../ui";
import styles from "./course-setting-print-page.module.css";

const cmykText = (cmyk: Cmyk100 | { c: number; m: number; y: number; k: number }, scale = 1) =>
  [cmyk.c, cmyk.m, cmyk.y, cmyk.k].map(value => Math.round(value * scale * 10) / 10).join("/");

/** Profilen som går att ändra: en sparad egen eller en godkänd kopia; en färdig kopieras först (kartfilen ändras aldrig). */
export function editableCopy(profile: PrintProfile, builtIn: readonly PrintProfile[] = BUILT_IN_PRINT_PROFILES, now = Date.now()): PrintProfile {
  if (!builtIn.some(item => item.id === profile.id)) return profile;
  if (profile.reference) return { ...profile, id: `${profile.id}-godkand`, name: `${profile.name} – godkänd för kartan`, basedOn: profile.id, colorDecisions: [] };
  return { ...profile, id: `egen-${now}`, name: `${profile.name} (kopia)`, basedOn: profile.id };
}

/** Status för den valda profilen: godkänd, färger kvar att bekräfta, eller som i filen. */
export function profileStatus(profile: PrintProfile, colors: readonly MapColor[], usage: ReadonlyMap<number, ColorUsage>): { kind: "APPROVED" | "PENDING" | "PLAIN"; pending: number } {
  if (!profile.reference) return { kind: "PLAIN", pending: 0 };
  if (colors.length === 0) return { kind: "PENDING", pending: 0 };
  const pending = proposalState(profile, colors, usage)?.counts.pending ?? 0;
  return { kind: pending === 0 ? "APPROVED" : "PENDING", pending };
}

/**
 * ADR-0215 (ändrar ADR-0211 beslut 6): "Färger för tryck" som en statusrad med "Visa" och två lägen: "Kartans egna färger"
 * (förval, kartfilens färger i normens ordning, inget att ställa in) och "Tryck hos BL" (bara de tveksamma färgerna,
 * `doubtful`). Hela flödet från ADR-0211 beslut 6 (profilen, banans färg, färgordningen, BL:s hela lista, färgerna för hand,
 * förhandskontrollen och JSON) ligger under "Avancerat", stängt som förval. En tävling med egna inställningar behåller dem.
 * Allt sparas genast i tävlingens kopia av profilen; kartfilen ändras aldrig.
 */
export function PrintColors({ saved, profile, colors, usage, norm, detectedNorm, layers, readOnly, onSelect, onSave, cards, doubtful }: {
  saved: readonly PrintProfile[]; profile: PrintProfile; colors: readonly MapColor[]; usage: ReadonlyMap<number, ColorUsage>;
  /** Normen som gäller och den som kartan ger (ADR-0211 beslut 3). */
  norm: PressNorm; detectedNorm: PressNorm;
  /** Kartans färger över och under banan (samma som förhandsvisningen); `undefined` = banan överst. */
  layers: PressLayers | undefined;
  readOnly: boolean; onSelect: (id: string) => void; onSave: (edits: CourseSettingEdit[]) => Promise<boolean>;
  /** BL:s hela lista (under Avancerat) och bara de tveksamma färgerna (läget "Tryck hos BL"), ritade av sidan. */
  cards?: ReactNode; doubtful?: ReactNode;
}) {
  const text = useTexts(printColorsSv, printColorsEn);
  const all = useMemo(() => [...BUILT_IN_PRINT_PROFILES, ...saved], [saved]);
  const listed = all.filter(item => !SUPERSEDED_PRINT_PROFILES[item.id] || item.id === profile.id);
  const status = useMemo(() => profileStatus(profile, colors, usage), [profile, colors, usage]);
  const mode = colorModeOf(profile);
  const summary = useMemo(() => colorSummary(profile, colors, usage, layers, norm), [profile, colors, usage, layers, norm]);
  const [advanced, setAdvanced] = useState(false);
  const [shown, setShown] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const file = useRef<HTMLInputElement>(null);
  const report = useMemo(() => colors.length > 0 ? colorPreflight(profile, sourceMapColors(colors, usage)) : undefined, [profile, colors, usage]);

  /** Sparar en ändring av profilen (i en kopia om den är färdig) och väljer den för tävlingen. */
  const change = async (next: (current: PrintProfile) => PrintProfile) => {
    if (readOnly) return;
    const copy = next(editableCopy(profile));
    const ok = await onSave(approvalEdits(copy));
    setMessage(ok ? { tone: "ok", text: text.saved } : { tone: "error", text: text.saveFailed });
  };
  async function importFile(chosen: File | undefined) {
    if (!chosen) return;
    try {
      const imported = parsePrintProfile(await chosen.text());
      const ok = await onSave(approvalEdits(imported));
      setMessage(ok ? { tone: "ok", text: text.saved } : { tone: "error", text: text.saveFailed });
    } catch (error) { setMessage({ tone: "error", text: (error as Error).message }); }
  }
  const select = (id: string) => { setMessage(undefined); onSelect(id); };
  const chip = status.kind === "APPROVED" ? text.chipApproved : status.kind === "PENDING" ? text.chipPending(status.pending) : text.chipPlain;
  const line = summary.mode === "MAP_OWN" ? text.statusMapOwn(summary.total, summary.over)
    : summary.mode === "BL" ? text.statusBl(summary.family, summary.pending, summary.total) : text.statusCustom(summary.name);
  return <section className={styles.panel} aria-labelledby="print-colors" data-testid="print-profile" data-status={status.kind} data-mode={mode}
    data-open={advanced ? "yes" : "no"}>
    <h2 id="print-colors" className={styles.colorBarTitle}>{text.heading}</h2>
    <div className={styles.statusLine}>
      <strong data-testid="print-profile-status" data-mode={mode}>{line}</strong>
      <Button variant="quiet" aria-expanded={shown} aria-controls="print-colors-details" onClick={() => setShown(!shown)}
        data-testid="print-colors-show">{shown ? text.hide : text.show}</Button>
    </div>
    {shown && <ColorDetails profile={profile} colors={colors} usage={usage} layers={layers} norm={norm} />}
    <div className={styles.row} role="radiogroup" aria-label={text.modeLabel}>
      <label className={styles.check}><input type="radio" name="print-colors-mode" checked={mode === "MAP_OWN"} disabled={readOnly}
        onChange={() => select(MAP_OWN_PRINT_PROFILE_ID)} data-testid="print-colors-mode-map" />{text.modeMapOwn}</label>
      <label className={styles.check}><input type="radio" name="print-colors-mode" checked={mode === "BL"} disabled={readOnly}
        onChange={() => select(blProfileIdFor(detectedNorm))} data-testid="print-colors-mode-bl" />{text.modeBl}</label>
    </div>
    <p className={styles.muted} data-testid="print-colors-mode-help">{text.modeHelp[mode]}</p>
    {message && <Notice tone={message.tone === "ok" ? "ok" : "error"} role="status"><p>{message.text}</p></Notice>}
    {/* Läget "Tryck hos BL": bara de tveksamma färgerna; under Avancerat står BL:s hela lista i stället. */}
    {mode === "BL" && !advanced && doubtful}
    <details className={styles.advanced} open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)} data-testid="print-colors-advanced">
      <summary data-testid="print-colors-edit">{text.advanced}</summary>
      {advanced && <div className={styles.stack} data-testid="print-colors-flow">
        <p className={styles.muted}>{text.advancedHelp}</p>
        <div className={styles.colorBar}>
          <label className={styles.field}>{text.profile}
            <select value={profile.id} onChange={event => select(event.target.value)} data-testid="print-profile-select">
              {listed.map(item => <option key={item.id} value={item.id}>{item.name}{SUPERSEDED_PRINT_PROFILES[item.id] ? ` (${text.superseded})` : ""}</option>)}
            </select></label>
          <span className={styles.statusChip} data-status={status.kind} data-testid="print-profile-chip">{chip}</span>
          {!readOnly && <Button variant="quiet" data-testid="print-colors-new"
            onClick={() => void change(current => ({ ...current, id: `egen-${Date.now()}`, name: text.newName, basedOn: profile.basedOn ?? profile.id }))}>
            {text.newProfile}</Button>}
        </div>
        {/* 1. Profilen, normen och banans färg. */}
        <fieldset className={styles.row} disabled={readOnly}>
          <legend>{text.courseHeading}</legend>
          {!readOnly && <label className={styles.field}>{text.name}
            <input defaultValue={profile.name} key={`${profile.id}-name`} onBlur={event => {
              const name = event.target.value.trim(); if (name && name !== profile.name) void change(current => ({ ...current, name }));
            }} /></label>}
          <span className={styles.swatch} style={{ background: cmykToCss(profile.course.cmyk) }} aria-hidden="true" />
          <label className={styles.field}>{text.courseCmyk}<input defaultValue={cmykText(profile.course.cmyk)} key={`${profile.id}-course-${cmykText(profile.course.cmyk)}`}
            data-testid="print-profile-course-cmyk" onBlur={event => {
              const cmyk = parseCmyk(event.target.value);
              if (cmyk && cmykText(cmyk) !== cmykText(profile.course.cmyk)) void change(current => ({ ...current, course: { ...current.course, cmyk } }));
            }} /></label>
          <label className={styles.field}>{text.spotName}<input defaultValue={profile.course.spotName} key={`${profile.id}-spot`} onBlur={event => {
            const spotName = event.target.value.trim(); if (spotName && spotName !== profile.course.spotName) void change(current => ({ ...current, course: { ...current.course, spotName } }));
          }} /></label>
          <label className={styles.check}><input type="checkbox" checked={profile.course.overprint}
            onChange={event => void change(current => ({ ...current, course: { ...current.course, overprint: event.target.checked } }))} />{text.overprint}</label>
        </fieldset>
        <fieldset className={styles.row} disabled={readOnly} data-testid="print-colors-order">
          <legend>{text.orderHeading}</legend>
          <label className={styles.check}><input type="checkbox" checked={profile.courseLayer === "REFERENCE"} data-testid="bl-course-layer"
            onChange={event => void change(current => ({ ...current, courseLayer: event.target.checked ? "REFERENCE" : "TOP" }))} />{text.normOrder}</label>
          <label className={styles.field}>{text.norm}
            <select value={profile.pressNorm ?? ""} data-testid="print-colors-norm"
              onChange={event => void change(current => event.target.value ? { ...current, pressNorm: event.target.value as PressNorm }
                : Object.fromEntries(Object.entries(current).filter(([key]) => key !== "pressNorm")) as unknown as PrintProfile)}>
              <option value="">{text.normAuto(text.norms[detectedNorm])}</option>
              <option value="ISOM">{text.norms.ISOM}</option>
              <option value="ISSPROM">{text.norms.ISSPROM}</option>
            </select></label>
          {norm === "ISOM" && <label className={styles.check}><input type="checkbox" checked={profile.numbersOnTop ?? false} data-testid="print-colors-numbers-top"
            onChange={event => void change(current => ({ ...current, numbersOnTop: event.target.checked }))} />{text.numbersOnTop}</label>}
        </fieldset>
        <p className={styles.muted} data-testid="print-colors-order-help">{profile.courseLayer === "REFERENCE" ? text.orderHelp[norm] : text.orderTop}</p>
        {/* 2. Förslagskorten: huvudsättet att arbeta med tryckeriets tabell. */}
        {cards}
        {/* 3. Samma värden per färg för hand. */}
        {colors.length === 0 ? <p className={styles.muted}>{text.noColors}</p>
          : <ColorTable profile={profile} colors={colors} readOnly={readOnly} onChange={next => void change(next)} />}
        {report && <div className={styles.stack} data-testid="print-preflight">
          <h3>{text.preflight} {report.canPrint ? text.preflightOk : text.preflightBlocked}</h3>
          {report.findings.length === 0 ? <p className={styles.muted}>{text.noFindings}</p>
            : <ul className={styles.findings}>{report.findings.map((finding, index) => <li key={index} data-severity={finding.severity}>
              <strong>{text.severity[finding.severity]}</strong> {finding.text}</li>)}</ul>}
        </div>}
        <details data-testid="print-colors-more">
          <summary>{text.more}</summary>
          <div className={styles.row}>
            <Button variant="secondary" onClick={() => downloadText(`${profile.id}.json`, JSON.stringify(profile, null, 2), "application/json")}>{text.export}</Button>
            {!readOnly && <><Button variant="secondary" onClick={() => file.current?.click()}>{text.import}</Button>
              <input ref={file} type="file" accept="application/json,.json" hidden onChange={event => void importFile(event.target.files?.[0])} /></>}
          </div>
          {profile.description && <p className={styles.muted}>{profile.description}</p>}
          {profile.sourceUrl && <p className={styles.muted}>{text.source}: <a href={profile.sourceUrl} target="_blank" rel="noreferrer">{profile.sourceUrl}</a>
            {profile.sourceDate ? ` (${profile.sourceDate})` : ""}</p>}
        </details>
      </div>}
    </details>
  </section>;
}

/** "Visa": vad statusraden betyder, normen, banans färg och kartans färger över och under banan (det som trycks). */
function ColorDetails({ profile, colors, usage, layers, norm }: {
  profile: PrintProfile; colors: readonly MapColor[]; usage: ReadonlyMap<number, ColorUsage>; layers: PressLayers | undefined; norm: PressNorm;
}) {
  const text = useTexts(printColorsSv, printColorsEn);
  const used = useMemo(() => usedColors(colors, usage).sort((a, b) => a.rank - b.rank || a.id - b.id), [colors, usage]);
  const over = new Set(layers?.over ?? []);
  const list = (items: readonly MapColor[], testId: string) => items.length === 0 ? <p className={styles.muted} data-testid={testId}>{text.detailsNone}</p>
    : <ul className={styles.colorList} data-testid={testId}>{items.map(color => <li key={color.id} data-color={color.id}>
      <span className={styles.swatch} style={{ background: `rgb(${Math.round(color.rgb.r * 255)}, ${Math.round(color.rgb.g * 255)}, ${Math.round(color.rgb.b * 255)})` }}
        aria-hidden="true" />{color.name}</li>)}</ul>;
  return <div id="print-colors-details" className={styles.stack} data-testid="print-colors-details">
    <p className={styles.muted}>{profile.courseLayer === "REFERENCE" ? `${text.detailsNorm(text.norms[norm])} ${text.orderHelp[norm]}` : text.detailsTop}</p>
    <p className={styles.muted}><span className={styles.swatch} style={{ background: cmykToCss(profile.course.cmyk) }} aria-hidden="true" />
      {text.detailsCourse(cmykText(profile.course.cmyk), profile.course.spotName)}</p>
    {layers && used.length > 0 && <div className={styles.colorColumns}>
      <section><h3>{text.detailsOver}</h3>{list(used.filter(color => over.has(color.id)), "print-colors-over")}</section>
      <section><h3>{text.detailsUnder}</h3>{list(used.filter(color => !over.has(color.id)), "print-colors-under")}</section>
    </div>}
  </div>;
}

/**
 * "Justera färger för hand": kartans färger med de värden som gäller (ur förslaget eller egna). En ändring här blir en egen
 * rad för färgen som gäller före förslagets rad; korten visar det, och ett beslut på kortet tar bort den egna raden.
 */
function ColorTable({ profile, colors, readOnly, onChange }: {
  profile: PrintProfile; colors: readonly MapColor[]; readOnly: boolean; onChange: (next: (current: PrintProfile) => PrintProfile) => void;
}) {
  const text = useTexts(printColorsSv, printColorsEn);
  const adjust = useMemo(() => mapColorAdjust(profile, colors), [profile, colors]);
  const ordered = useMemo(() => [...colors].sort((a, b) => a.rank - b.rank || a.id - b.id), [colors]);
  return <details className={styles.tableBox} data-testid="print-colors-manual">
    <summary>{text.manual}</summary>
    <table className={styles.table} data-testid="print-profile-colors">
      <caption className={styles.muted}>{text.colorsCaption}</caption>
      <thead><tr><th>{text.color}</th><th>OCAD</th><th>{text.fileCmyk}</th><th>{text.visible}</th><th>{text.lighten}</th><th>{text.newCmyk}</th><th>{text.spot}</th></tr></thead>
      <tbody>{ordered.map(color => {
        const row = rowFor(profile, color.id);
        const effective = adjust[color.id];
        const decision = profile.reference ? decisionFor(profile.colorDecisions, { ocadId: color.id, name: color.name }) : undefined;
        const blRow = decision?.row && profile.reference ? referenceRow(profile.reference, decision.row) : undefined;
        const shown = row?.cmyk ? cmykText(row.cmyk) : effective?.cmyk ? cmykText(effective.cmyk, 100) : "";
        return <tr key={color.id} data-color={color.id} data-source={row ? "HAND" : blRow ? "PROPOSAL" : "FILE"}>
          <td><span className={styles.swatch} style={{ background: `rgb(${Math.round(color.rgb.r * 255)}, ${Math.round(color.rgb.g * 255)}, ${Math.round(color.rgb.b * 255)})` }}
            aria-hidden="true" />{color.name}</td>
          <td>{color.id}</td>
          <td>{cmykText(color.cmyk, 100)}</td>
          <td><input type="checkbox" aria-label={`${text.visible}: ${color.name}`} checked={!effective?.hidden} disabled={readOnly}
            onChange={event => onChange(current => withColorRow(current, color.id, { hidden: !event.target.checked }))} /></td>
          <td><input type="number" min={-100} max={100} step={5} aria-label={`${text.lighten}: ${color.name}`} className={styles.small}
            defaultValue={row?.lighten ?? Math.round((effective?.lighten ?? 0) * 100)} key={`${profile.id}-${color.id}-l-${row?.lighten ?? 0}`} disabled={readOnly}
            onBlur={event => { const value = Number(event.target.value) || undefined; if (value !== row?.lighten) onChange(current => withColorRow(current, color.id, { lighten: value })); }} /></td>
          <td><input aria-label={`${text.newCmyk}: ${color.name}`} className={styles.medium} defaultValue={shown} placeholder="c/m/y/k"
            key={`${profile.id}-${color.id}-${shown}`} disabled={readOnly} title={blRow && !row ? text.fromProposal(blRow.name) : undefined}
            onBlur={event => {
              const value = event.target.value.trim();
              if (value === shown) return;
              const cmyk = parseCmyk(value);
              if (value === "") onChange(current => withColorRow(current, color.id, { cmyk: undefined }));
              else if (cmyk) onChange(current => withColorRow(current, color.id, { cmyk }));
            }} />
            {blRow && !row && <small className={styles.muted}> {text.fromProposalShort}</small>}
            {row && <small className={styles.muted}> {text.byHand}</small>}</td>
          <td><input type="checkbox" aria-label={`${text.spot}: ${color.name}`} checked={Boolean(row?.spot ?? color.spot?.overprint)} disabled={readOnly}
            onChange={event => onChange(current => withColorRow(current, color.id, { spot: event.target.checked ? { name: color.name, overprint: true } : undefined }))} /></td>
        </tr>;
      })}</tbody>
    </table>
  </details>;
}
