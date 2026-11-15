"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { BingoGroup } from "@o-tid/contracts";
import { bingoCellPosition, judgeShots, placeShips, scoreShots, type JudgedShot, type Shot, type ShotResult } from "@o-tid/domain";
import { bingoEn } from "../../i18n/bingo-en";
import { bingoSv } from "../../i18n/bingo-sv";
import { useTexts } from "../language-provider";
import styles from "./bingo.module.css";

const MARK: Readonly<Record<ShotResult, string>> = { SUNK: "✓", HIT: "●", WATER: "~", WRONG: "✗" };

/** Löparens skepp och de bedömda skotten (samma regler som servern). */
export function useShips(group: BingoGroup, seed: number | undefined, shots: readonly Shot[], metersPerMm: number) {
  return useMemo(() => {
    const ships = seed === undefined ? [] : placeShips(group.cells.map(cell => cell.name), group.ships, seed);
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
export function ShipBoard({ group, judged, sunkCells, selected, onSelect, dark, label }: { group: BingoGroup; judged: readonly JudgedShot[];
  sunkCells: ReadonlySet<string>; selected: string | undefined; onSelect?: (cell: string) => void; dark?: boolean; label: string }) {
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
      </button>;
    })}
  </div>;
}

/** Valet av ruta och Skjut i fickläget; beskedet efter skottet. */
export function ShipFire({ onFire, aiming, now, children }: { onFire: (cell: string) => Promise<void>; aiming: { cell: string; since: number } | undefined;
  now: number; children: (selected: string | undefined, select: (cell: string) => void) => ReactNode }) {
  const text = useTexts(bingoSv.ships, bingoEn.ships);
  const [selected, setSelected] = useState<string>();
  return <>
    {children(selected, cell => setSelected(current => current === cell ? undefined : cell))}
    {aiming ? <p className={styles.status} role="status">{text.searching(Math.max(0, Math.round((now - aiming.since) / 1000)))}</p>
      : selected ? <button type="button" className={styles.fire} data-testid="ship-fire"
        onClick={() => { const cell = selected; setSelected(undefined); void onFire(cell); }}>{text.fire(selected)}</button>
        : <p className={styles.status}>{text.choose}</p>}
  </>;
}
