"use client";

import { useMemo, type KeyboardEvent } from "react";
import type { ForkingChoice, ForkingItem } from "@o-tid/domain";
import { layoutForkingDiagram, type DiagramTarget } from "../../lib/forking-diagram";
import { forkingSv as text } from "../../i18n/forking-sv";
import styles from "./forking-diagram.module.css";

type Props = {
  items: readonly ForkingItem[];
  letters?: readonly (readonly string[] | null)[];
  /** Markerad väg (löparens variant). */
  choices?: readonly ForkingChoice[] | undefined;
  compact?: boolean;
  count?: (item: number, branch: number) => { text: string; description: string } | undefined;
  /** Redigering: klick på en kontroll, en sträcka eller ett alternativ. */
  onSelect?: (target: DiagramTarget) => void;
  selected?: DiagramTarget | undefined;
  label: string;
  caption?: React.ReactNode;
};

const sameTarget = (left: DiagramTarget | undefined, right: DiagramTarget | undefined) => JSON.stringify(left) === JSON.stringify(right);

/**
 * Banbilden (steg 49): start till mål med gafflingarna som grenar och fjärilarna som kronblad. Med `onSelect` är
 * kontroller, sträckor och alternativ knappar (tangentbord och pekskärm). Bilden rullar i sidled inom sin ruta.
 */
export function ForkingDiagram({ items, letters, choices, compact = false, count, onSelect, selected, label, caption }: Props) {
  const layout = useMemo(() => layoutForkingDiagram(items, { compact, choices, ...(letters ? { letters } : {}), ...(count ? { count } : {}) }),
    [items, compact, choices, letters, count]);
  const press = (target: DiagramTarget) => (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect?.(target); }
  };
  const describe = (target: DiagramTarget) => {
    if (target.kind === "LEG") {
      const name = (item: ForkingItem | undefined, fallback: string) =>
        item?.kind === "CONTROL" ? String(item.code) : item?.kind === "LOOP" ? String(item.center) : fallback;
      return text.legButton(name(items[target.before - 1], text.start), name(items[target.before], text.finish));
    }
    if (target.kind === "CONTROL") {
      const item = items[target.item];
      return text.controlButton(item?.kind === "CONTROL" ? item.code : item?.kind === "LOOP" ? item.center : 0, item?.kind === "LOOP");
    }
    return text.branchButton(letters?.[target.item]?.[target.branch] ?? String(target.branch + 1), items[target.item]?.kind === "LOOP");
  };
  const interactive = !!onSelect && !compact;
  const svg = <svg className={`${styles.svg} ${compact ? styles.compact : ""}`} viewBox={`0 0 ${layout.width} ${layout.height}`}
    width={compact ? Math.min(layout.width * 1.6, 360) : layout.width} height={compact ? undefined : layout.height}
    role="img" aria-label={label}>
    <title>{label}</title>
    {layout.edges.map(edge => <path key={edge.key} className={styles.edge} d={edge.d} data-active={edge.active ?? undefined} />)}
    {layout.nodes.map(node => <g key={node.key} className={styles.node} data-node="" data-kind={node.kind} data-active={node.active ?? undefined}
      data-first-of={node.first && node.target?.kind === "BRANCH" ? `${node.target.item}.${node.target.branch}` : undefined}>
      {node.kind === "START" ? <polygon points={`${node.x - layout.radius},${node.y + layout.radius * 0.8} ${node.x + layout.radius},${node.y + layout.radius * 0.8} ${node.x},${node.y - layout.radius}`} />
        : <circle cx={node.x} cy={node.y} r={node.kind === "SPLIT" ? layout.radius * 0.3 : layout.radius} />}
      {node.kind === "FINISH" && <circle cx={node.x} cy={node.y} r={layout.radius * 0.66} />}
      {!compact && node.kind !== "START" && node.kind !== "FINISH" && node.kind !== "SPLIT" && <text x={node.x} y={node.y}>{node.label}</text>}
    </g>)}
    {/* Etiketterna har en egen ruta (med bakgrund) som aldrig täcker kontroller, sträckor eller andra etiketter. Bokstaven och
        antalen ("E · 3/1") sitter intill grenens första kontroll. */}
    {layout.labels.map(item => <g key={item.key} data-label={item.kind} data-active={item.active ?? undefined}
      data-branch={item.target?.kind === "BRANCH" ? `${item.target.item}.${item.target.branch}` : undefined}>
      {item.description && <title>{text.branchCount(item.description)}</title>}
      {item.detail && <rect className={styles.labelBox} x={item.x - item.width / 2} y={item.y - item.height / 2}
        width={item.width} height={item.height} rx={3} />}
      <text x={item.x} y={item.y} data-active={item.active ?? undefined} aria-label={item.description ? text.branchCount(item.description) : undefined}
        className={item.kind === "LETTER" ? styles.letter : styles.order}>{item.text}
        {item.detail && <tspan className={styles.count}>{` · ${item.detail}`}</tspan>}</text>
    </g>)}
    {interactive && <>
      {layout.edges.filter(edge => edge.target?.kind === "LEG").map(edge => <circle key={`hit-${edge.key}`} cx={edge.mid.x} cy={edge.mid.y} r={11}
        className={`${styles.hit} ${sameTarget(selected, edge.target) ? styles.selected : ""}`} role="button" tabIndex={0}
        aria-label={describe(edge.target!)} aria-pressed={sameTarget(selected, edge.target)}
        onClick={() => onSelect(edge.target!)} onKeyDown={press(edge.target!)} />)}
      {layout.nodes.filter(node => node.target).map(node => <circle key={`hit-${node.key}`} cx={node.x} cy={node.y} r={layout.radius + 4}
        className={`${styles.hit} ${sameTarget(selected, node.target) ? styles.selected : ""}`} role="button" tabIndex={0}
        aria-label={`${describe(node.target!)}${node.target!.kind === "BRANCH" ? ` (${node.label})` : ""}`} aria-pressed={sameTarget(selected, node.target)}
        onClick={() => onSelect(node.target!)} onKeyDown={press(node.target!)} />)}
    </>}
  </svg>;
  return <figure className={styles.figure}>
    {compact ? svg : <div className={styles.scroll}>{svg}</div>}
    {caption && <figcaption className={styles.caption}>{caption}</figcaption>}
  </figure>;
}
