"use client";

import { useMemo, useRef, useState } from "react";
import {
  BUILT_IN_PRINT_PROFILES, cmykToCss, colorPreflight, mapColorAdjust, parsePrintProfile, sourceMapColors, type Cmyk100, type CourseSettingEdit,
  type PrintProfile
} from "@o-tid/course-setting";
import type { MapColor } from "@o-tid/map-file";
import { printProfileSv as text } from "../../i18n/course-setting-print-profile-sv";
import { downloadText } from "../../lib/course-setting-api";
import { parseCmyk, rowFor, withColorRow } from "../../lib/course-setting-print-settings";
import { Button, Notice } from "../ui";
import styles from "./course-setting-print-page.module.css";

const cmykText = (cmyk: Cmyk100 | { c: number; m: number; y: number; k: number }, scale = 1) =>
  [cmyk.c, cmyk.m, cmyk.y, cmyk.k].map(value => Math.round(value * scale * 10) / 10).join("/");

/**
 * Steg 64 (ADR-0183): utskriftsprofilen. Välj en färdig eller sparad profil, kopiera den för att rätta kartans färger
 * (dölj, ljusare/mörkare, ny CMYK, dekorfärg med övertryck) och banans färg, utan att kartfilen ändras. Förhandskontrollen
 * visar vad som stämmer mot profilens regler; den ändrar ingenting.
 */
export function PrintProfilePanel({ saved, selectedId, colors, readOnly, onSelect, onSave }: {
  saved: readonly PrintProfile[]; selectedId: string; colors: readonly MapColor[]; readOnly: boolean;
  onSelect: (id: string) => void; onSave: (edits: CourseSettingEdit[]) => Promise<boolean>;
}) {
  const all = useMemo(() => [...BUILT_IN_PRINT_PROFILES, ...saved], [saved]);
  const active = all.find(profile => profile.id === selectedId) ?? BUILT_IN_PRINT_PROFILES[0]!;
  const [draft, setDraft] = useState<PrintProfile>();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());
  const profile = draft ?? active;
  const builtIn = BUILT_IN_PRINT_PROFILES.some(item => item.id === profile.id);
  const report = useMemo(() => colors.length > 0 ? colorPreflight(profile, sourceMapColors(colors), undefined, confirmed) : undefined, [profile, colors, confirmed]);
  const adjust = useMemo(() => mapColorAdjust(profile, colors), [profile, colors]);
  const ordered = useMemo(() => [...colors].sort((a, b) => a.rank - b.rank || a.id - b.id), [colors]);
  const file = useRef<HTMLInputElement>(null);
  const edit = (next: PrintProfile) => { if (!readOnly) setDraft(next.id === active.id && builtIn ? { ...next, id: `egen-${Date.now()}`, name: `${active.name} (kopia)` } : next); };
  async function save() {
    if (!draft) return;
    const ok = await onSave([{ type: "PUT_PRINT_PROFILE", profile: draft }, { type: "SET_EVENT", changes: { printProfileId: draft.id } }]);
    setMessage(ok ? { tone: "ok", text: text.saved } : { tone: "error", text: text.saveFailed });
    if (ok) setDraft(undefined);
  }
  async function importFile(chosen: File | undefined) {
    if (!chosen) return;
    try { setDraft(parsePrintProfile(await chosen.text())); setMessage(undefined); } catch (error) { setMessage({ tone: "error", text: (error as Error).message }); }
  }
  return <section className={styles.panel} aria-labelledby="print-profile" data-testid="print-profile">
    <h2 id="print-profile">{text.heading}</h2>
    <p className={styles.muted}>{text.help}</p>
    <div className={styles.row}>
      <label className={styles.field}>{text.choose}
        <select value={draft ? "" : active.id} onChange={event => { setDraft(undefined); setConfirmed(new Set()); onSelect(event.target.value); }} data-testid="print-profile-select">
          {draft && <option value="">{draft.name} ({text.unsaved})</option>}
          {all.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
      {!readOnly && <label className={styles.field}>{text.name}
        <input value={profile.name} onChange={event => edit({ ...profile, name: event.target.value })} /></label>}
      {!readOnly && draft && <Button onClick={() => void save()}>{text.save}</Button>}
      <Button variant="secondary" onClick={() => downloadText(`${profile.id}.json`, JSON.stringify(profile, null, 2), "application/json")}>{text.export}</Button>
      {!readOnly && <><Button variant="secondary" onClick={() => file.current?.click()}>{text.import}</Button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={event => void importFile(event.target.files?.[0])} /></>}
    </div>
    {profile.description && <p className={styles.muted}>{profile.description}</p>}
    {message && <Notice tone={message.tone === "ok" ? "ok" : "error"}><p>{message.text}</p></Notice>}
    <fieldset className={styles.row} disabled={readOnly}>
      <legend>{text.course}</legend>
      <span className={styles.swatch} style={{ background: cmykToCss(profile.course.cmyk) }} aria-hidden="true" />
      <label className={styles.field}>CMYK<input defaultValue={cmykText(profile.course.cmyk)} key={`${profile.id}-course`} data-testid="print-profile-course-cmyk"
        onChange={event => { const cmyk = parseCmyk(event.target.value); if (cmyk) edit({ ...profile, course: { ...profile.course, cmyk } }); }} /></label>
      <label className={styles.field}>{text.spotName}<input value={profile.course.spotName}
        onChange={event => edit({ ...profile, course: { ...profile.course, spotName: event.target.value } })} /></label>
      <label className={styles.check}><input type="checkbox" checked={profile.course.overprint}
        onChange={event => edit({ ...profile, course: { ...profile.course, overprint: event.target.checked } })} />{text.overprint}</label>
    </fieldset>
    {colors.length === 0 ? <p className={styles.muted}>{text.noColors}</p> : <div className={styles.tableBox}>
      <table className={styles.table} data-testid="print-profile-colors">
        <caption className={styles.muted}>{text.colorsCaption}</caption>
        <thead><tr><th>{text.color}</th><th>OCAD</th><th>{text.fileCmyk}</th><th>{text.visible}</th><th>{text.lighten}</th><th>{text.newCmyk}</th><th>{text.spot}</th></tr></thead>
        <tbody>{ordered.map(color => {
          const row = rowFor(profile, color.id);
          const effective = adjust[color.id];
          return <tr key={color.id} data-color={color.id}>
            <td><span className={styles.swatch} style={{ background: `rgb(${Math.round(color.rgb.r * 255)}, ${Math.round(color.rgb.g * 255)}, ${Math.round(color.rgb.b * 255)})` }}
              aria-hidden="true" />{color.name}</td>
            <td>{color.id}</td>
            <td>{cmykText(color.cmyk, 100)}</td>
            <td><input type="checkbox" aria-label={`${text.visible}: ${color.name}`} checked={!effective?.hidden} disabled={readOnly}
              onChange={event => edit(withColorRow(profile, color.id, { hidden: !event.target.checked }))} /></td>
            <td><input type="number" min={-100} max={100} step={5} aria-label={`${text.lighten}: ${color.name}`} className={styles.small}
              value={row?.lighten ?? Math.round((effective?.lighten ?? 0) * 100)} disabled={readOnly}
              onChange={event => edit(withColorRow(profile, color.id, { lighten: Number(event.target.value) || undefined }))} /></td>
            <td><input aria-label={`${text.newCmyk}: ${color.name}`} className={styles.medium} defaultValue={row?.cmyk ? cmykText(row.cmyk) : ""} placeholder="c/m/y/k"
              key={`${profile.id}-${color.id}`} disabled={readOnly}
              onChange={event => { const value = event.target.value.trim(); const cmyk = parseCmyk(value);
                if (value === "" || cmyk) edit(withColorRow(profile, color.id, { cmyk })); }} /></td>
            <td><input type="checkbox" aria-label={`${text.spot}: ${color.name}`} checked={Boolean(row?.spot ?? color.spot?.overprint)} disabled={readOnly}
              onChange={event => edit(withColorRow(profile, color.id, { spot: event.target.checked ? { name: color.name, overprint: true } : undefined }))} /></td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
    {report && <div className={styles.stack} data-testid="print-preflight">
      <h3>{text.preflight} {report.canPrint ? text.preflightOk : text.preflightBlocked}</h3>
      {report.findings.length === 0 ? <p className={styles.muted}>{text.noFindings}</p>
        : <ul className={styles.findings}>{report.findings.map((finding, index) => <li key={index} data-severity={finding.severity}>
          <strong>{text.severity[finding.severity]}</strong> {finding.text}
          {finding.severity === "BLOCKING" && finding.rule && report.results.find(result => result.rule === finding.rule)?.status === "NEEDS_CONFIRMATION" &&
            <Button variant="quiet" onClick={() => setConfirmed(current => new Set([...current, finding.rule!]))}>{text.confirm}</Button>}
        </li>)}</ul>}
    </div>}
  </section>;
}
