"use client";

import type { BingoGroup } from "@o-tid/contracts";
import { bingoCellPosition } from "../../lib/bingo-run";
import styles from "./bingo.module.css";

/** Bingobrickan: gruppens rutor i rutnätet, de tagna ifyllda med en bock (inte bara färg). */
export function BingoCard({ group, taken, dark, label }: { group: BingoGroup; taken: ReadonlySet<string>; dark?: boolean; label: string }) {
  const placed = group.cells.map(cell => ({ cell, at: bingoCellPosition(cell.name) })).filter(item => item.at !== undefined);
  const columns = Math.max(1, ...placed.map(item => item.at!.column + 1));
  return <div className={dark ? styles.cardDark : styles.card} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    role="img" aria-label={label} data-testid="bingo-card">
    {placed.map(({ cell, at }) => <span key={cell.name} style={{ gridColumn: at!.column + 1, gridRow: at!.row + 1 }}
      data-taken={taken.has(cell.name) || undefined}>{taken.has(cell.name) ? `✓${cell.name}` : cell.name}</span>)}
  </div>;
}
