"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { BingoGroup } from "@o-tid/contracts";
import { bingoCellPosition, judgeShots, placeGroupShips, scoreShots, type JudgedShot, type Shot, type ShotResult } from "@o-tid/domain";
import { bingoEn } from "../../i18n/bingo-en";
import { bingoSv } from "../../i18n/bingo-sv";
import { useTexts } from "../language-provider";
import styles from "./bingo.module.css";

const MARK: Readonly<Record<ShotResult, string>> = { SUNK: "✓", HIT: "●", WATER: "~", WRONG: "✗" };

/** Löparens skepp och de bedömda skotten (samma regler som servern). */
export function useShips(group: BingoGroup, seed: number | undefined, shots: readonly Shot[], metersPerMm: number) {
  return useMemo(() => {
    const ships = seed === undefined ? [] : placeGroupShips(group.cells.map(cell => cell.name), { shared: group.sharedShips, own: group.ships },
      group.sharedSeed, seed);
    const judged = judgeShots(shots, group.cells, ships, metersPerMm);
    return { ships, judged, score: scoreShots(judged) };
  }, [group, seed, shots, metersPerMm]);
}

/** Rutans läge på skottbrädet: det senaste giltiga skottet, annars fel om löparen sköt fel där. */
function cellStates(judged: readonly JudgedShot[]): Map<string, ShotResult> {
  const out = new Map<string, ShotResult>();
  for (const shot of judged) if (shot.result !== "WRONG" || !out.has(shot.cell)) out.set(shot.cell, shot.result);
  return out;
}

/**
 * Skottbrädet (Sänka skepp): rutnätet med träff, sänkt, vatten och fel. En ruta som inte är skjuten (eller bara fel) kan
 * väljas. Ingen karta och ingen position visas under loppet.
 */
export function ShipBoard({ group, judged, sunkCells, selected, onSelect, dark, label, others }: { group: BingoGroup; judged: readonly JudgedShot[];
  sunkCells: ReadonlySet<string>; selected: string | undefined; onSelect?: (cell: string) => void; dark?: boolean; label: string;
  /** Hur många andra i gruppen som stått i rutan och skjutit (prickarna). */
  others?: Readonly<Record<string, number>> | undefined }) {
  const text = useTexts(bingoSv.ships, bingoEn.ships);
  const states = cellStates(judged);
  const placed = group.cells.map(cell => ({ cell, at: bingoCellPosition(cell.name) })).filter(item => item.at !== undefined);
  const columns = Math.max(1, ...placed.map(item => item.at!.column + 1));
  return <div className={dark ? styles.cardDark : styles.card} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    role="group" aria-label={label} data-testid="ship-board">
    {placed.map(({ cell, at }) => {
      const state = sunkCells.has(cell.name) ? "SUNK" : states.get(cell.name);
      const open = state === undefined || state === "WRONG";
      return <button key={cell.name} type="button" className={styles.shipCell} style={{ gridColumn: at!.column + 1, gridRow: at!.row + 1 }}
        data-state={state} aria-pressed={selected === cell.name} disabled={!onSelect || !open}
        aria-label={`${cell.name}${state && state !== "WRONG" ? `, ${text.shot}` : ""}`} onClick={() => onSelect?.(cell.name)}>
        {state ? `${MARK[state]}${cell.name}` : cell.name}
        <ShotDots count={others?.[cell.name] ?? 0} label={text.others} />
      </button>;
    })}
  </div>;
}

/** Prickarna i rutans hörn: en per person upp till 4, sedan en siffra. Neutrala: säger inte om det var träff. */
function ShotDots({ count, label }: { count: number; label: (count: number) => string }) {
  if (count <= 0) return null;
  return <span className={styles.dots} aria-label={label(count)} title={label(count)}>
    {count > 4 ? count : Array.from({ length: count }, (_, i) => <i key={i} aria-hidden="true" />)}</span>;
}

/**
 * Rutnätet på tävlingssidan (Sänka skepp): «där klubben har varit», prickar för hur många som stått i rutan och skjutit.
 */
export function ShotHeatGrid({ cellNames, counts, label }: { cellNames: readonly string[]; counts: Readonly<Record<string, number>>; label: string }) {
  const text = useTexts(bingoSv.ships, bingoEn.ships);
  const placed = cellNames.map(name => ({ name, at: bingoCellPosition(name) })).filter(item => item.at !== undefined);
  const columns = Math.max(1, ...placed.map(item => item.at!.column + 1));
  return <div className={styles.card} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} role="img" aria-label={label}
    data-testid="ship-heat">
    {placed.map(({ name, at }) => <span key={name} className={styles.heatCell} style={{ gridColumn: at!.column + 1, gridRow: at!.row + 1 }}>
      {name}<ShotDots count={counts[name] ?? 0} label={text.others} /></span>)}
  </div>;
}

/** Valet av ruta och Skjut i fickläget; beskedet efter skottet. */
export function ShipFire({ onFire, aiming, now, children }: { onFire: (cell: string) => Promise<void>; aiming: { cell: string; since: number } | undefined;
  now: number; children: (selected: string | undefined, select: (cell: string) => void) => ReactNode }) {
  const text = useTexts(bingoSv.ships, bingoEn.ships);
  const [selected, setSelected] = useState<string>();
  // Ägaren 2026-11-17: Skjut både ovanför och under brädet, så att knappen syns i små telefoner var man än har scrollat.
  const action = (where: "top" | "bottom") => aiming
    ? <p className={styles.status} role={where === "top" ? "status" : undefined}>{text.searching(Math.max(0, Math.round((now - aiming.since) / 1000)))}</p>
    : selected ? <button type="button" className={styles.fire} data-testid={where === "top" ? "ship-fire" : "ship-fire-bottom"}
      onClick={() => { const cell = selected; setSelected(undefined); void onFire(cell); }}>{text.fire(selected)}</button>
      : <p className={styles.status}>{text.choose}</p>;
  return <>
    {action("top")}
    {children(selected, cell => setSelected(current => current === cell ? undefined : cell))}
    {action("bottom")}
  </>;
}
