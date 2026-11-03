"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  BUILT_IN_PRINT_PROFILES, cmykToCss, colorPreflight, decisionFor, mapColorAdjust, parsePrintProfile, referenceRow, sourceMapColors,
  SUPERSEDED_PRINT_PROFILES, type Cmyk100, type CourseSettingEdit, type PressNorm, type PrintProfile
} from "@o-tid/course-setting";
import type { ColorUsage, MapColor } from "@o-tid/map-file";
import { printColorsSv as text } from "../../i18n/course-setting-print-colors-sv";
import { downloadText } from "../../lib/course-setting-api";
import { approvalEdits, proposalState } from "../../lib/course-setting-bl-proposal";
import { parseCmyk, rowFor, withColorRow } from "../../lib/course-setting-print-settings";
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
 * ADR-0211 beslut 6: "Färger för tryck" i ett flöde. Överst en kompakt rad (profil, status, "Redigera färger", "Ny profil");
 * hela flödet visas medan profilen inte är godkänd eller när man öppnar det: profilen, normen och banans färg, sedan
 * förslagskorten (BL) och sist "Justera färger för hand" med samma värden per färg som korten sätter. Allt sparas genast i
 * tävlingens kopia av profilen; kartfilen ändras aldrig.
 */
export function PrintColors({ saved, profile, colors, usage, norm, detectedNorm, readOnly, onSelect, onSave, cards }: {
  saved: readonly PrintProfile[]; profile: PrintProfile; colors: readonly MapColor[]; usage: ReadonlyMap<number, ColorUsage>;
  /** Normen som gäller och den som kartan ger (ADR-0211 beslut 3). */
  norm: PressNorm; detectedNorm: PressNorm;
  readOnly: boolean; onSelect: (id: string) => void; onSave: (edits: CourseSettingEdit[]) => Promise<boolean>;
  /** Förslagskorten (BL-profilerna), ritade av sidan. */
  cards?: ReactNode;
}) {
  const all = useMemo(() => [...BUILT_IN_PRINT_PROFILES, ...saved], [saved]);
  const listed = all.filter(item => !SUPERSEDED_PRINT_PROFILES[item.id] || item.id === profile.id);
  const status = useMemo(() => profileStatus(profile, colors, usage), [profile, colors, usage]);
  const [open, setOpen] = useState<boolean>();
  const expanded = open ?? status.kind === "PENDING";
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
  const chip = status.kind === "APPROVED" ? text.chipApproved : status.kind === "PENDING" ? text.chipPending(status.pending) : text.chipPlain;
  return <section className={styles.panel} aria-labelledby="print-colors" data-testid="print-profile" data-status={status.kind} data-open={expanded ? "yes" : "no"}>
    <div className={styles.colorBar}>
      <h2 id="print-colors" className={styles.colorBarTitle}>{text.heading}</h2>
      <label className={styles.field}>{text.profile}
        <select value={profile.id} onChange={event => { setMessage(undefined); onSelect(event.target.value); }} data-testid="print-profile-select">
          {listed.map(item => <option key={item.id} value={item.id}>{item.name}{SUPERSEDED_PRINT_PROFILES[item.id] ? ` (${text.superseded})` : ""}</option>)}
        </select></label>
      <span className={styles.statusChip} data-status={status.kind} data-testid="print-profile-status">{chip}</span>
      <Button variant="secondary" aria-expanded={expanded} onClick={() => setOpen(!expanded)} data-testid="print-colors-edit">
        {expanded ? text.close : text.edit}</Button>
      {!readOnly && <Button variant="quiet" data-testid="print-colors-new"
        onClick={() => { setOpen(true); void change(current => ({ ...current, id: `egen-${Date.now()}`, name: text.newName, basedOn: profile.basedOn ?? profile.id })); }}>
        {text.newProfile}</Button>}
    </div>
    {message && <Notice tone={message.tone === "ok" ? "ok" : "error"} role="status"><p>{message.text}</p></Notice>}
    {expanded && <div className={styles.stack} data-testid="print-colors-flow">
      <p className={styles.muted}>{text.intro}</p>
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
        {norm === "ISOM" && <label className={styles.check}><input type="checkbox" checked={profile.numbersOnTop ?? true} data-testid="print-colors-numbers-top"
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
  </section>;
}

/**
 * "Justera färger för hand": kartans färger med de värden som gäller (ur förslaget eller egna). En ändring här blir en egen
 * rad för färgen som gäller före förslagets rad; korten visar det, och ett beslut på kortet tar bort den egna raden.
 */
function ColorTable({ profile, colors, readOnly, onChange }: {
  profile: PrintProfile; colors: readonly MapColor[]; readOnly: boolean; onChange: (next: (current: PrintProfile) => PrintProfile) => void;
}) {
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
