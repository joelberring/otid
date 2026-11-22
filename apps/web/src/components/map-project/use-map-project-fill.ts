"use client";

import { useEffect, useRef, useState } from "react";
import type { Point } from "@o-tid/map-file";
import { newKey } from "@o-tid/map-revision";
import { mapProjectFillEn } from "../../i18n/map-project-fill-en";
import { mapProjectFillSv } from "../../i18n/map-project-fill-sv";
import { toScreen, type Viewport } from "../../lib/course-setting-viewport";
import { FILL_BRIDGE_M, FILL_GAP_M, FILL_LARGE_WINDOWS_M, fillObject, type FillBridge, type FillResult } from "../../lib/map-project-fill-area";
import type { CatalogSymbol, MapProjectSession, ProjectHit } from "../../lib/map-project-protocol";
import { useLocale, useTexts } from "../language-provider";
import { useMapProjectAreaProposals } from "./use-map-project-area-proposals";
import type { ObjectChange } from "./use-map-project-editor";
import { insideRings, useMapProjectFillCells } from "./use-map-project-fill-cells";

type Found = Extract<FillResult, { status: "found" }>;

/**
 * Ägaren 2026-11-13 («fylla ytor»; sprintkartans ytor): verktyget Fyll yta. Med en ytsymbol vald visar pekaren rutan som
 * kartans synliga linjer och ytkanter bildar under den (räknas i Workern, `map-project-fill-area.ts`), och ett klick eller
 * ett tryck med fingret lägger in den som en vanlig ändring (ett förslag för den som bara får föreslå; Ångra tar bort den).
 * Är rutan inte sluten sägs varför, och öppningarna som hittas ritas röda. På en sprintkarta hör Föreslå ytor hit
 * (`use-map-project-area-proposals.ts`): ett klick i en kandidatyta lägger in den, annars fylls rutan under klicket som vanligt.
 * K8b V2 (magisk fyll): glapp utöver grundtoleransen upp till `gapM` (hörn som inte möts, förlängningar, bryggor) ritas
 * orange streckade ovanpå rutans kant; Alt+klick (`exact`) fyller bara exakt.
 * K8b V4: dra över flera rutor (eller ⇧+klick, eller «+ ruta» i telefonen) blir en yta (`use-map-project-fill-cells.ts`);
 * reservens ungefärliga yta och fingrets första tryck visas först (`pending`) och läggs in med ett andra klick i den; en ruta
 * som redan täcks av en yta läggs inte in igen (ytan markeras, så att C byter dess symbol).
 */
export function useMapProjectFill(input: { session: MapProjectSession | undefined; active: boolean; symbol: CatalogSymbol | undefined;
  /** Släckta symboler: de är inga gränser. */
  hidden: readonly string[]; commit: (change: ObjectChange) => boolean; say: (message: string) => void;
  /** Föreslå ytor: symbolerna, kartans skala (normen) och flera ändringar som en ångringsbar grupp. */
  symbols: ReadonlyMap<string, CatalogSymbol>; scale: number | undefined; commitMany: (changes: readonly ObjectChange[]) => number;
  /** Glapp (m) för steg 2; förval `FILL_BRIDGE_M`. */
  gapM?: number | undefined;
  /** Markerar ytan som redan täcker rutan, och tangenten för Byt symbol. */
  select?: ((hit: ProjectHit) => void) | undefined; switchKey?: string | undefined }) {
  const text = useTexts(mapProjectFillSv, mapProjectFillEn);
  const locale = useLocale();
  const { session, active, symbol } = input;
  const gapM = input.gapM ?? FILL_BRIDGE_M;
  const [preview, setPreview] = useState<Point[][]>();
  /** Bitarna som slöts utöver grundtoleransen i rutan under pekaren (orange). */
  const [bridges, setBridges] = useState<readonly FillBridge[]>([]);
  const [gaps, setGaps] = useState<readonly (readonly [Point, Point])[]>([]);
  /** Visas och väntar på ett andra klick i den: reservens ungefärliga yta, eller fingrets första tryck. */
  const [pending, setPending] = useState<Found>();
  /** Telefonens «+ ruta»: varje tryck lägger till en ruta, «Lägg in» fyller. */
  const [cellsMode, setCellsMode] = useState(false);
  /** Pekarens frågor går en i taget: `waiting` är frågan som är ute, `next` punkten som väntar på tur. */
  const hovering = useRef<{ waiting: boolean; next: Point | undefined; exact?: boolean }>({ waiting: false, next: undefined });
  /** Ett klick är på väg: pekaren frågar inte under tiden (bara det senaste svaret kommer fram). */
  const filling = useRef(false);
  /** Dragningen som samlar rutor: om den lägger in när den släpps (musen utan Skift). */
  const drag = useRef<{ commit: boolean; touch: boolean } | undefined>(undefined);
  const proposals = useMapProjectAreaProposals(input);
  const cells = useMapProjectFillCells({ session, hidden: input.hidden, gapM, scale: input.scale });
  const usable = active && symbol?.kind === "area";
  useEffect(() => {
    if (usable) return;
    setPreview(undefined); setBridges([]); setGaps([]); setPending(undefined); hovering.current.next = undefined; cells.clear();
  }, [usable]);
  const squareMeters = (value: number) => (value < 10 ? Math.round(value * 10) / 10 : Math.round(value)).toLocaleString(locale);

  function ask(point: Point, exact: boolean) {
    if (!session) return;
    hovering.current = { waiting: true, next: undefined, exact };
    session.fill({ point, hidden: input.hidden, diagnose: false, gapM, exact }, result => {
      const next = hovering.current.next;
      hovering.current.waiting = false;
      setPreview(result.status === "found" ? result.rings : undefined);
      setBridges(result.status === "found" ? result.bridges : []);
      if (next) ask(next, hovering.current.exact ?? false);
    });
  }

  /** Pekaren över kartan (musen): rutan under den visas; med Alt nedtryckt (`exact`) det exakta resultatet (K8b V1). */
  function hover(point: Point | undefined, exact = false) {
    if (!usable || filling.current || cells.busy() || drag.current) return;
    if (!point || proposals.inCandidate(point) || (pending && insideRings(pending.rings, point)) || (cells.rings && insideRings(cells.rings, point))) {
      hovering.current.next = undefined; setPreview(undefined); setBridges([]); return;
    }
    if (hovering.current.waiting) { hovering.current.next = point; hovering.current.exact = exact; } else ask(point, exact);
  }

  function add(rings: readonly (readonly Point[])[]): boolean {
    return !!symbol && input.commit({ key: newKey(crypto.randomUUID()), ref: null, kind: "ADD", after: { kind: "OBJECT", object: fillObject(symbol.id, rings) } });
  }

  /** De samlade rutorna som en yta (när Workern svarat på det som är ute). */
  function commitCells() {
    cells.whenIdle(() => {
      const now = cells.current();
      cells.clear();
      const skipped = text.skipped(now.open, now.covered);
      if (!symbol || now.rings.length === 0) { input.say([text.noCells, skipped].filter(Boolean).join(" ")); return; }
      input.say(add(now.rings) ? [text.merged(symbol.code, now.count, squareMeters(now.areaM2)), skipped].filter(Boolean).join(" ") : text.notSaved);
    });
  }

  function addCell(point: Point, touch: boolean) {
    setPreview(undefined); setBridges([]); setPending(undefined);
    // Rutornas frågor tar över Workerns svar: pekarens fråga som är ute kommer inte fram.
    hovering.current = { waiting: false, next: undefined };
    cells.add(point);
    cells.whenIdle(() => { const now = cells.current(); input.say([text.collecting(now.count, squareMeters(now.areaM2), touch), text.skipped(now.open, now.covered)].filter(Boolean).join(" ")); });
  }

  /**
   * Klicket eller trycket: rutan läggs in med den valda symbolen; `exact` (Alt+klick) sluter bara glapp upp till
   * grundtoleransen. ⇧+klick (och «+ ruta» med fingret) lägger till rutan i de samlade; ett vanligt klick lägger in dem.
   */
  function tap(point: Point, exact = false, pointer: { readonly pointerType?: string; readonly free?: boolean } = {}) {
    if (proposals.tap(point)) return;
    if (!session || !symbol || symbol.kind !== "area") { input.say(text.needsArea); return; }
    if (filling.current) return;
    const touch = pointer.pointerType === "touch";
    if (pointer.free || (touch && cellsMode)) { addCell(point, touch); return; }
    if (cells.cells.count > 0 || cells.busy()) { hovering.current = { waiting: false, next: undefined }; cells.add(point); commitCells(); return; }
    if (pending && insideRings(pending.rings, point)) { setPending(undefined); report(pending, add(pending.rings)); return; }
    filling.current = true;
    hovering.current = { waiting: false, next: undefined };
    session.fill({ point, hidden: input.hidden, diagnose: true, gapM, exact }, (result, covered) => {
      filling.current = false;
      setPreview(undefined); setBridges([]); setPending(undefined);
      if (result.status === "open") {
        setGaps(result.gaps);
        input.say(result.gaps.length ? text.openGap(exact ? FILL_GAP_M : Math.max(FILL_GAP_M, gapM), result.gaps.length) : text.openFar(FILL_LARGE_WINDOWS_M[FILL_LARGE_WINDOWS_M.length - 1]!));
        return;
      }
      setGaps([]);
      if (result.covered) {
        const code = input.symbols.get(result.covered.symbol)?.code ?? "";
        if (result.covered.symbol === symbol.id) { input.say(text.alreadyFilled(code)); return; }
        if (covered) input.select?.(covered);
        input.say(text.coveredAs(code, input.switchKey ?? "C"));
        return;
      }
      if (result.approx || touch) {
        setPending(result);
        input.say(result.approx ? text.approx(touch) : text.confirm(symbol.code, squareMeters(result.areaM2)));
        return;
      }
      report(result, add(result.rings));
    });
  }

  function report(result: Found, ok: boolean) {
    if (!symbol) return;
    input.say(ok ? text.done(symbol.code, squareMeters(result.areaM2), result.closed, bridgeSummary(result.bridges)) : text.notSaved);
  }

  /** Bryggorna i beskedet, t.ex. «1 hörn slutet (3,1 m + 2,2 m)». */
  function bridgeSummary(list: readonly FillBridge[]): string {
    const metres = (value: number) => `${(Math.round(value * 10) / 10).toLocaleString(locale)} m`;
    return (["corner", "extend", "bridge"] as const).flatMap(kind => {
      const of = list.filter(bridge => bridge.kind === kind);
      return of.length ? [text.bridged(kind, of.length, of.map(bridge => bridge.lengthsM.map(metres).join(" + ")).join("; "))] : [];
    }).join(", ");
  }

  /** En dragning med Fyll: musen alltid (utom med mellanslag), fingret bara med «+ ruta». Falskt = kartan flyttas. */
  function dragStart(point: Point, pointerType: string): boolean {
    if (!usable || !session || filling.current || (pointerType === "touch" && !cellsMode)) return false;
    drag.current = { commit: pointerType !== "touch", touch: pointerType === "touch" };
    hovering.current = { waiting: false, next: undefined };
    setPreview(undefined); setBridges([]); setPending(undefined); setGaps([]);
    cells.track(point);
    return true;
  }
  function dragMove(point: Point, shift: boolean) {
    if (!drag.current) return;
    if (shift) drag.current.commit = false;
    cells.track(point);
  }
  function dragEnd() {
    const current = drag.current;
    drag.current = undefined;
    cells.lift();
    if (current?.commit) commitCells();
    else if (current) cells.whenIdle(() => { const now = cells.current(); input.say(text.collecting(now.count, squareMeters(now.areaM2), current.touch)); });
  }

  /** Esc: töm det samlade och det som väntar. Sant = något tömdes. */
  function escape(): boolean {
    if (!cells.cells.count && !cells.busy() && !pending && gaps.length === 0) return false;
    cells.clear(); setPending(undefined); setGaps([]); drag.current = undefined;
    return true;
  }

  /** Rutan under pekaren (i symbolens färg), bryggorna (orange) och öppningarna (röda), ovanpå kartan. */
  function draw(ctx: CanvasRenderingContext2D, view: Viewport) {
    proposals.draw(ctx, view);
    if (!active) return;
    ctx.save();
    const shape = (rings: readonly (readonly Point[])[]) => {
      ctx.beginPath();
      for (const ring of rings) {
        ring.forEach((point, index) => { const at = toScreen(view, point); if (index === 0) ctx.moveTo(at.x, at.y); else ctx.lineTo(at.x, at.y); });
        ctx.closePath();
      }
      ctx.globalAlpha = 0.5; ctx.fillStyle = symbol?.fill ?? "#1a5fd0"; ctx.fill("evenodd"); ctx.globalAlpha = 1;
      ctx.setLineDash([]); ctx.lineWidth = 4; ctx.strokeStyle = "#fff"; ctx.stroke();
    };
    for (const rings of [preview, cells.rings, pending && !pending.approx ? pending.rings : undefined]) {
      if (!rings) continue;
      shape(rings);
      ctx.lineWidth = 2; ctx.strokeStyle = "#1a5fd0"; ctx.setLineDash([6, 4]); ctx.stroke();
    }
    if (pending?.approx) {
      // Reservens gissade yta: streckad orange och blå om vartannat.
      shape(pending.rings);
      ctx.lineWidth = 3; ctx.setLineDash([6, 6]);
      ctx.strokeStyle = "#e8740c"; ctx.lineDashOffset = 0; ctx.stroke();
      ctx.strokeStyle = "#1a5fd0"; ctx.lineDashOffset = 6; ctx.stroke();
      ctx.lineDashOffset = 0;
    }
    if (preview && bridges.length) {
      // Glappen som slöts utöver grundtoleransen, orange streckade ovanpå kanten.
      ctx.beginPath();
      for (const bridge of bridges) for (const [from, to] of bridge.pieces) {
        const a = toScreen(view, from), b = toScreen(view, to);
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
      ctx.setLineDash([]); ctx.lineWidth = 5; ctx.strokeStyle = "#fff"; ctx.stroke();
      ctx.lineWidth = 3; ctx.strokeStyle = "#e8740c"; ctx.setLineDash([5, 3]); ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const [from, to] of gaps) {
      const a = toScreen(view, from), b = toScreen(view, to);
      // En ring runt öppningen (syns också när den är kort på skärmen) och själva öppningen.
      ctx.lineWidth = 6; ctx.strokeStyle = "#fff"; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.lineWidth = 3; ctx.strokeStyle = "#d0021b"; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.beginPath(); ctx.arc((a.x + b.x) / 2, (a.y + b.y) / 2, Math.max(12, Math.hypot(b.x - a.x, b.y - a.y) / 2 + 6), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  return { hover, tap, draw, preview, bridges, gaps, pending, proposals, dragStart, dragMove, dragEnd, dragging: () => !!drag.current, escape,
    /** Ritas om när något av det här ändras. */
    shown: cells.rings,
    /** Telefonens «+ ruta» och «Lägg in» (statusraden). */
    cells: usable ? { on: cellsMode, onToggle: () => setCellsMode(value => !value), count: cells.cells.count, onCommit: commitCells,
      text: { mode: text.cellsMode, help: text.cellsHelp, commit: text.cellsCommit } } : undefined,
    hint: symbol?.kind === "area" ? `${text.hint(symbol.code, FILL_GAP_M, Math.max(FILL_GAP_M, gapM))} ${text.dragHint}` : text.needsArea };
}
