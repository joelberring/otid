"use client";

import { useEffect, useRef, useState } from "react";
import { courseSettingUxSv as ux } from "../../i18n/course-setting-ux-sv";
import { drawOverprint } from "../../lib/course-setting-draw";
import { PALETTE, paletteIcon, paletteKey, type PaletteItem } from "../../lib/course-setting-palette";
import { Button } from "../ui";
import styles from "./course-setting-ux.module.css";

/** En bild som ska läggas på kartan (base64 utan "data:"-början). */
export interface PendingImage { readonly format: string; readonly data: string; readonly aspect: number; readonly name: string }

const IMAGE_MAX_BYTES = 1024 * 1024;

/** Ikonen ritad med kartans ritare i en liten canvas. */
function PaletteIcon({ item }: { item: PaletteItem }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const size = 40, ratio = window.devicePixelRatio || 1;
    canvas.width = size * ratio; canvas.height = size * ratio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const icon = paletteIcon(item);
    const side = Math.max(icon.bounds.maxX - icon.bounds.minX, icon.bounds.maxY - icon.bounds.minY);
    drawOverprint(ctx, { centerX: (icon.bounds.minX + icon.bounds.maxX) / 2, centerY: (icon.bounds.minY + icon.bounds.maxY) / 2,
      pxPerMm: size / side, width: size, height: size }, icon.primitives);
  }, [item]);
  return <canvas ref={ref} className={styles.icon} aria-hidden="true" data-testid={`course-setting-palette-icon-${paletteKey(item)}`} />;
}

/**
 * Paletten: knappen Objekt i verktygsraden öppnar den. Grupperna Passager och kartbyte, Spärrar, Service och Text och
 * grafik; varje slag med ikon, namn och en rad som förklarar det. Bild väljs från datorn först.
 */
export function ObjectPalette({ active, onPick, onClose }: {
  active: string | undefined; onPick: (item: PaletteItem, image?: PendingImage) => void; onClose: () => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  async function readImage(chosen: File) {
    if (chosen.size > IMAGE_MAX_BYTES) { setError(ux.palette.imageTooLarge); return; }
    try {
      const url = URL.createObjectURL(chosen);
      const bitmap = await createImageBitmap(chosen);
      URL.revokeObjectURL(url);
      const bytes = new Uint8Array(await chosen.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      const format = chosen.type === "image/jpeg" ? "jpeg" : chosen.type === "image/gif" ? "gif" : chosen.type === "image/bmp" ? "bmp" : "png";
      onPick({ kind: "special", special: "image" }, { format, data: btoa(binary), aspect: bitmap.height / Math.max(1, bitmap.width), name: chosen.name });
      bitmap.close();
    } catch (failure) { console.error("Bilden gick inte att läsa", failure); setError(ux.palette.imageFailed); }
  }
  return <section className={styles.popover} role="dialog" aria-label={ux.palette.heading} data-testid="course-setting-palette">
    <div className={styles.popoverHead}><h2>{ux.palette.heading}</h2>
      <Button variant="quiet" onClick={onClose}>{ux.palette.close}</Button></div>
    {PALETTE.map(group => <fieldset key={group.group} className={styles.group}>
      <legend>{ux.palette.groups[group.group]}</legend>
      <div className={styles.items}>
        {group.items.map(item => {
          const key = paletteKey(item);
          const [name, help] = ux.palette.items[key] ?? [key, ""];
          return <button key={key} type="button" className={styles.item} aria-pressed={active === key} data-testid={`course-setting-palette-${key}`}
            onClick={() => { if (item.kind === "special" && item.special === "image") file.current?.click(); else onPick(item); }}>
            <PaletteIcon item={item} /><span><strong>{name}</strong><span>{help}</span></span>
          </button>;
        })}
      </div>
    </fieldset>)}
    <input ref={file} type="file" accept="image/png,image/jpeg,image/gif" hidden aria-label={ux.palette.imagePick} data-testid="course-setting-palette-image-file"
      onChange={event => { const chosen = event.target.files?.[0]; event.target.value = ""; if (chosen) void readImage(chosen); }} />
    {error && <p role="alert">{error}</p>}
  </section>;
}

/** "Gaffla här": antal grenar eller slinga. */
export function ForkPicker({ onFork, onClose }: { onFork: (kind: "FORK" | "LOOP", count: number) => void; onClose: () => void }) {
  return <section className={styles.popover} role="dialog" aria-label={ux.forks.forkHere} data-testid="course-setting-fork-picker">
    <div className={styles.popoverHead}><h2>{ux.forks.forkHere}</h2><Button variant="quiet" onClick={onClose}>{ux.palette.close}</Button></div>
    <div className={styles.choices}>
      {[2, 3, 4].map(count => <Button key={count} variant="secondary" onClick={() => onFork("FORK", count)}>{ux.forks.branches(count)}</Button>)}
      <Button variant="secondary" onClick={() => onFork("LOOP", 1)}>{ux.forks.loop}</Button>
      <Button variant="secondary" onClick={() => onFork("LOOP", 2)}>{ux.forks.loops(2)}</Button>
    </div>
  </section>;
}

/** Raden när man arbetar i en gren: vilken gren, Nästa gren och Klar. */
export function ForkBar({ letter, count, onNext, onDone }: { letter: string; count: number; onNext: () => void; onDone: () => void }) {
  return <div className={styles.forkBar} role="status" data-testid="course-setting-fork-bar">
    <strong>{ux.forks.branchOf(letter, count)}</strong><span>{ux.forks.working}</span>
    {count > 1 && <Button variant="secondary" onClick={onNext}>{ux.forks.next} →</Button>}
    <Button variant="quiet" onClick={onDone}>{ux.forks.done}</Button>
  </div>;
}

/** "Alltid ny" medan man lägger till kontroller i en bana (samma som Alt). */
export function ForceNew({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return <label className={styles.forceNew} title={ux.snap.forceNewHelp}>
    <input type="checkbox" checked={on} onChange={event => onChange(event.target.checked)} />{ux.snap.forceNew}</label>;
}

/** Kartans visningsval: andra banor svagt, oanvända kontroller och markeringarna (kollade, notiser, varningar). */
export function ViewOptions({ others, onOthers, unused, toggles = [] }: { others: boolean; onOthers: (on: boolean) => void;
  unused?: { count: number; on: boolean; onChange: (on: boolean) => void } | undefined;
  toggles?: readonly { label: string; on: boolean; onChange: (on: boolean) => void }[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  return <div className={styles.viewButton} ref={box}>
    <Button variant="secondary" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(value => !value)}>{ux.view.button} ▾</Button>
    {open && <div className={styles.viewMenu} role="group" aria-label={ux.view.heading}>
      <label><input type="checkbox" checked={others} onChange={event => onOthers(event.target.checked)} />{ux.view.otherCourses}</label>
      {unused && <label><input type="checkbox" checked={unused.on} onChange={event => unused.onChange(event.target.checked)} />{ux.view.unused(unused.count)}</label>}
      {toggles.map(toggle => <label key={toggle.label}><input type="checkbox" checked={toggle.on} onChange={event => toggle.onChange(event.target.checked)} />
        {toggle.label}</label>)}
    </div>}
  </div>;
}

/** Vinkeln för en passage: sifferfältet, "Vrid efter sträckan" och hjälpen om handtaget. */
export function RotateControls({ orientation, readOnly, onSet, onAlong }: { orientation: number; readOnly: boolean;
  onSet: (degrees: number) => void; onAlong?: (() => void) | undefined }) {
  const [draft, setDraft] = useState(String(Math.round(orientation * 10) / 10));
  useEffect(() => setDraft(String(Math.round(orientation * 10) / 10)), [orientation]);
  const commit = () => { const value = Number(draft.replace(",", ".")); if (Number.isFinite(value) && value !== orientation) onSet(value); };
  return <div className={styles.group} data-testid="course-setting-rotate">
    <div className={styles.dialogActions}>
      <label className={styles.inlineLabel}>{ux.rotate.label}
        <input type="number" step={5} value={draft} disabled={readOnly} size={5} data-testid="course-setting-orientation"
          onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === "Enter") commit(); }} /></label>
      {onAlong && !readOnly && <Button variant="secondary" onClick={onAlong}>{ux.rotate.alongLeg}</Button>}
    </div>
    {!readOnly && <p className={styles.hint}>{ux.rotate.help}</p>}
  </div>;
}

/** En bekräftelse med en lista (kontrollerna som blir oanvända, de oanvända som tas bort) och knappar. */
export function ConfirmList({ intro, items, actions, testId }: { intro: string; items: readonly string[]; testId: string;
  actions: readonly { label: string; onClick: () => void; variant?: "primary" | "secondary" | "quiet" | undefined }[] }) {
  return <div className={styles.group} data-testid={testId}>
    <p>{intro}</p>
    {items.length > 0 && <ul className={styles.unusedList}>{items.map(label => <li key={label}>{label}</li>)}</ul>}
    <div className={styles.dialogActions}>
      {actions.map(action => <Button key={action.label} variant={action.variant ?? "primary"} onClick={action.onClick}>{action.label}</Button>)}
    </div>
  </div>;
}
