"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MapObject, Point } from "@o-tid/map-file";
import { mapNorm, splitLargeAreas } from "@o-tid/map-revision";
import { mapProjectFillEn } from "../../i18n/map-project-fill-en";
import { mapProjectFillSv } from "../../i18n/map-project-fill-sv";
import { toScreen, type Viewport } from "../../lib/course-setting-viewport";
import { FILL_BRIDGE_M, FILL_GAP_M, FILL_LARGE_WINDOWS_M, type FillBridge, type FillResult } from "../../lib/map-project-fill-area";
import { fillChangeList, type FillOverlay } from "../../lib/map-project-fill-over";
import type { CatalogSymbol, MapProjectSession, ProjectHit } from "../../lib/map-project-protocol";
import { useLocale, useTexts } from "../language-provider";
import { useMapProjectAreaProposals } from "./use-map-project-area-proposals";
import type { ObjectChange } from "./use-map-project-editor";
import { insideRings, useMapProjectFillCells } from "./use-map-project-fill-cells";
import { BUILT_MAINS } from "@o-tid/map-revision/base-map";
import type { UnderChange } from "../../lib/map-project-fill-under";

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
 * K8b V7 Fyll över (`over`): rutan räknas bara av linjer och hårda ytor, markytorna som den nya ytan täcker skrafferas röda i
 * förhandsvisningen och klipps i samma ångringsbara grupp som ytan (`map-project-fill-over.ts`); en yta ur de stora fönstren
 * visas först. Dubblettskyddet gäller då bara hårda ytor och en markyta med samma symbol som redan täcker hela rutan.
 */
export function useMapProjectFill(input: { session: MapProjectSession | undefined; active: boolean; symbol: CatalogSymbol | undefined;
  /** Släckta symboler: de är inga gränser. */
  hidden: readonly string[]; commit: (change: ObjectChange) => boolean; say: (message: string) => void;
  /** Föreslå ytor: symbolerna, kartans skala (normen) och flera ändringar som en ångringsbar grupp. */
  symbols: ReadonlyMap<string, CatalogSymbol>; scale: number | undefined; commitMany: (changes: readonly ObjectChange[]) => number;
  /** Glapp (m) för steg 2; förval `FILL_BRIDGE_M`. */
  gapM?: number | undefined;
  /** K8b V7: Fyll över ytor (statusradens brytare). */
  over?: boolean | undefined;
  /** Markerar ytan som redan täcker rutan, och tangenten för Byt symbol. */
  select?: ((hit: ProjectHit) => void) | undefined; switchKey?: string | undefined }) {
  const text = useTexts(mapProjectFillSv, mapProjectFillEn);
  const locale = useLocale();
  const { session, active, symbol } = input;
  const gapM = input.gapM ?? FILL_BRIDGE_M;
  const norm = useMemo(() => mapNorm({ scale: input.scale, symbols: input.symbols.values() }), [input.scale, input.symbols]);
  /** Fyll över: kartans norm (vilka ytor som är markytor), annars undefined. */
  const over = input.over ? norm : undefined;
  /** Fyll över: det som klipps under rutan under pekaren (eller den som väntar). */
  const [overlay, setOverlay] = useState<FillOverlay>();
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
  const cells = useMapProjectFillCells({ session, hidden: input.hidden, gapM, scale: input.scale, over, symbol: symbol?.id });
  const usable = active && symbol?.kind === "area";
  useEffect(() => {
    if (usable) return;
    setPreview(undefined); setBridges([]); setGaps([]); setPending(undefined); setOverlay(undefined); hovering.current.next = undefined; cells.clear();
  }, [usable]);
  const squareMeters = (value: number) => (value < 10 ? Math.round(value * 10) / 10 : Math.round(value)).toLocaleString(locale);

  function ask(point: Point, exact: boolean) {
    if (!session) return;
    hovering.current = { waiting: true, next: undefined, exact };
    session.fill({ point, hidden: input.hidden, diagnose: false, gapM, exact, over, symbol: symbol?.id }, (result, _covered, _under, cut) => {
      const next = hovering.current.next;
      hovering.current.waiting = false;
      setPreview(result.status === "found" ? result.rings : undefined);
      setBridges(result.status === "found" ? result.bridges : []);
      setOverlay(result.status === "found" ? cut : undefined);
      if (next) ask(next, hovering.current.exact ?? false);
    });
  }

  /** Pekaren över kartan (musen): rutan under den visas; med Alt nedtryckt (`exact`) det exakta resultatet (K8b V1). */
  function hover(point: Point | undefined, exact = false) {
    if (!usable || filling.current || cells.busy() || drag.current) return;
    if (!point || proposals.inCandidate(point) || (pending && insideRings(pending.rings, point)) || (cells.rings && insideRings(cells.rings, point))) {
      hovering.current.next = undefined; setPreview(undefined); setBridges([]); if (!pending) setOverlay(undefined); return;
    }
    if (hovering.current.waiting) { hovering.current.next = point; hovering.current.exact = exact; } else ask(point, exact);
  }

  /**
   * Ytan som en ändring. Ägaren 2026-11-22 («berg hamnar ovanpå kvartersmark»): för tomtmark, hårdgjord yta och byggnad tas
   * markens detaljer och vegetationen under ytan bort eller klipps i samma grupp, så att Ångra tar tillbaka allt på en gång.
   */
  function add(rings: readonly (readonly Point[])[], under: readonly UnderChange[] = []): boolean {
    if (!symbol) return false;
    const scale = input.scale;
    const split = scale ? (object: MapObject) => splitLargeAreas([object], id => input.symbols.get(id)?.code, norm, scale) : undefined;
    const changes: ObjectChange[] = fillChangeList(symbol.id, rings, under, () => crypto.randomUUID(), split);
    if (changes.length === 1) return input.commit(changes[0]!);
    const done = input.commitMany(changes) > 0;
    if (done) cleared.current = under.length;
    return done;
  }
  /** Hur många objekt under den senaste ytan som togs bort eller klipptes (för beskedet). */
  const cleared = useRef(0);
  /** Det som ska bort under ytan som väntar på ett andra klick. */
  const pendingUnder = useRef<readonly UnderChange[]>([]);
  const clearUnder = !!symbol && BUILT_MAINS.has(Number(symbol.code.split(".")[0]));
  // Byter ytan symbol medan en fyllning väntar på bekräftelse gäller varken ytan eller det som skulle tas bort under den längre.
  useEffect(() => { setPending(undefined); setOverlay(undefined); pendingUnder.current = []; }, [symbol?.id, over]);

  /** De samlade rutorna som en yta (när Workern svarat på det som är ute). */
  function commitCells() {
    cells.whenIdle(() => {
      const now = cells.current();
      cells.clear();
      const skipped = text.skipped(now.open, now.covered);
      if (!symbol || now.rings.length === 0) { input.say([text.noCells, skipped].filter(Boolean).join(" ")); return; }
      const commit = (under: readonly UnderChange[]) => {
        const ok = add(now.rings, under), removed = cleared.current;
        cleared.current = 0;
        input.say(ok ? [text.merged(symbol.code, now.count, squareMeters(now.areaM2)), skipped, removed ? clearedText(removed) : ""].filter(Boolean).join(" ") : text.notSaved);
      };
      // Fyll över och rensningen under bebyggt räknas för hela den samlade ytan (ett objekt kan ligga under flera rutor).
      if (session && (over || clearUnder)) session.fillCuts({ rings: now.rings, hidden: input.hidden, clearUnder, over, symbol: symbol.id }, commit);
      else commit([]);
    });
  }

  function addCell(point: Point, touch: boolean) {
    setPreview(undefined); setBridges([]); setPending(undefined); setOverlay(undefined);
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
    if (pending && insideRings(pending.rings, point)) { setPending(undefined); setOverlay(undefined); report(pending, add(pending.rings, pendingUnder.current)); return; }
    filling.current = true;
    hovering.current = { waiting: false, next: undefined };
    session.fill({ point, hidden: input.hidden, diagnose: true, gapM, exact, clearUnder, over, symbol: symbol.id }, (result, covered, under, cut) => {
      filling.current = false;
      setPreview(undefined); setBridges([]); setPending(undefined); setOverlay(undefined);
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
      if (result.approx || touch || (over && result.large)) {
        setPending(result); setOverlay(cut);
        pendingUnder.current = under ?? [];
        input.say(result.approx ? text.approx(touch) : over && result.large ? text.overLarge(symbol.code, squareMeters(result.areaM2), touch)
          : [text.confirm(symbol.code, squareMeters(result.areaM2)), cut ? `${text.overNote(cut.count, cut.codes.join(", "))}.` : ""].filter(Boolean).join(" "));
        return;
      }
      report(result, add(result.rings, under ?? []));
    });
  }

  function report(result: Found, ok: boolean) {
    if (!symbol) return;
    const removed = cleared.current;
    cleared.current = 0;
    input.say(ok ? [text.done(symbol.code, squareMeters(result.areaM2), result.closed, bridgeSummary(result.bridges)), removed ? clearedText(removed) : ""].filter(Boolean).join(" ") : text.notSaved);
  }
  const clearedText = (count: number) => over ? text.overDone(count) : text.clearedUnder(count);

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
    cells.clear(); setPending(undefined); setGaps([]); setOverlay(undefined); drag.current = undefined;
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
    // Fyll över: det som klipps ur befintliga ytor, rödskrafferat.
    for (const removed of [overlay?.removed, cells.removed]) if (removed?.length) hatch(ctx, view, removed);
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
    shown: cells.rings, overlay,
    /** Fyll över: «Fyller över 3 ytor (403, 520)» för rutan under pekaren eller de samlade rutorna. */
    overNote: over && usable ? (cells.cells.count > 0 ? text.overNote(cells.over.count, cells.over.codes.join(", "))
      : overlay ? text.overNote(overlay.count, overlay.codes.join(", ")) : undefined) : undefined,
    /** Telefonens «+ ruta» och «Lägg in» (statusraden). */
    cells: usable ? { on: cellsMode, onToggle: () => setCellsMode(value => !value), count: cells.cells.count, onCommit: commitCells,
      text: { mode: text.cellsMode, help: text.cellsHelp, commit: text.cellsCommit } } : undefined,
    hint: symbol?.kind === "area" ? `${text.hint(symbol.code, FILL_GAP_M, Math.max(FILL_GAP_M, gapM))} ${text.dragHint}` : text.needsArea };
}

/** Områdena som klipps bort (Fyll över): röd skraffering med röd kant. */
function hatch(ctx: CanvasRenderingContext2D, view: Viewport, polygons: readonly (readonly (readonly Point[])[])[]) {
  ctx.save();
  ctx.beginPath();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const polygon of polygons) for (const ring of polygon) {
    ring.forEach((point, index) => {
      const at = toScreen(view, point);
      minX = Math.min(minX, at.x); minY = Math.min(minY, at.y); maxX = Math.max(maxX, at.x); maxY = Math.max(maxY, at.y);
      if (index === 0) ctx.moveTo(at.x, at.y); else ctx.lineTo(at.x, at.y);
    });
    ctx.closePath();
  }
  ctx.setLineDash([]); ctx.lineWidth = 1.5; ctx.strokeStyle = "#d0021b"; ctx.stroke();
  ctx.clip("evenodd");
  ctx.beginPath();
  for (let x = minX - (maxY - minY); x < maxX; x += 7) { ctx.moveTo(x, maxY); ctx.lineTo(x + (maxY - minY), minY); }
  ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(208, 2, 27, 0.8)"; ctx.stroke();
  ctx.restore();
}
