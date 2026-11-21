"use client";

import { useEffect, useRef, useState } from "react";
import type { Point } from "@o-tid/map-file";
import { newKey } from "@o-tid/map-revision";
import { mapProjectFillEn } from "../../i18n/map-project-fill-en";
import { mapProjectFillSv } from "../../i18n/map-project-fill-sv";
import { toScreen, type Viewport } from "../../lib/course-setting-viewport";
import { FILL_BRIDGE_M, FILL_GAP_M, FILL_WINDOW_M, fillObject, type FillBridge } from "../../lib/map-project-fill-area";
import type { CatalogSymbol, MapProjectSession } from "../../lib/map-project-protocol";
import { useLocale, useTexts } from "../language-provider";
import { useMapProjectAreaProposals } from "./use-map-project-area-proposals";
import type { ObjectChange } from "./use-map-project-editor";

/**
 * Ägaren 2026-11-13 («fylla ytor»; sprintkartans ytor): verktyget Fyll yta. Med en ytsymbol vald visar pekaren rutan som
 * kartans synliga linjer och ytkanter bildar under den (räknas i Workern, `map-project-fill-area.ts`), och ett klick eller
 * ett tryck med fingret lägger in den som en vanlig ändring (ett förslag för den som bara får föreslå; Ångra tar bort den).
 * Är rutan inte sluten sägs varför, och öppningarna som hittas ritas röda. På en sprintkarta hör Föreslå ytor hit
 * (`use-map-project-area-proposals.ts`): ett klick i en kandidatyta lägger in den, annars fylls rutan under klicket som vanligt.
 * K8b V2 (magisk fyll): glapp utöver grundtoleransen upp till `gapM` (hörn som inte möts, förlängningar, bryggor) ritas
 * orange streckade ovanpå rutans kant; Alt+klick (`exact`) fyller bara exakt.
 */
export function useMapProjectFill(input: { session: MapProjectSession | undefined; active: boolean; symbol: CatalogSymbol | undefined;
  /** Släckta symboler: de är inga gränser. */
  hidden: readonly string[]; commit: (change: ObjectChange) => boolean; say: (message: string) => void;
  /** Föreslå ytor: symbolerna, kartans skala (normen) och flera ändringar som en ångringsbar grupp. */
  symbols: ReadonlyMap<string, CatalogSymbol>; scale: number | undefined; commitMany: (changes: readonly ObjectChange[]) => number;
  /** Glapp (m) för steg 2; förval `FILL_BRIDGE_M`. */
  gapM?: number | undefined }) {
  const text = useTexts(mapProjectFillSv, mapProjectFillEn);
  const locale = useLocale();
  const { session, active, symbol } = input;
  const gapM = input.gapM ?? FILL_BRIDGE_M;
  const [preview, setPreview] = useState<Point[][]>();
  /** Bitarna som slöts utöver grundtoleransen i rutan under pekaren (orange). */
  const [bridges, setBridges] = useState<readonly FillBridge[]>([]);
  const [gaps, setGaps] = useState<readonly (readonly [Point, Point])[]>([]);
  /** Pekarens frågor går en i taget: `waiting` är frågan som är ute, `next` punkten som väntar på tur. */
  const hovering = useRef<{ waiting: boolean; next: Point | undefined }>({ waiting: false, next: undefined });
  /** Ett klick är på väg: pekaren frågar inte under tiden (bara det senaste svaret kommer fram). */
  const filling = useRef(false);
  const proposals = useMapProjectAreaProposals(input);
  const usable = active && symbol?.kind === "area";
  useEffect(() => { if (!usable) { setPreview(undefined); setBridges([]); setGaps([]); hovering.current.next = undefined; } }, [usable]);

  function ask(point: Point) {
    if (!session) return;
    hovering.current = { waiting: true, next: undefined };
    session.fill({ point, hidden: input.hidden, diagnose: false, gapM }, result => {
      const next = hovering.current.next;
      hovering.current.waiting = false;
      setPreview(result.status === "found" ? result.rings : undefined);
      setBridges(result.status === "found" ? result.bridges : []);
      if (next) ask(next);
    });
  }

  /** Pekaren över kartan (musen): rutan under den visas. */
  function hover(point: Point | undefined) {
    if (!usable || filling.current) return;
    if (!point || proposals.inCandidate(point)) { hovering.current.next = undefined; setPreview(undefined); setBridges([]); return; }
    if (hovering.current.waiting) hovering.current.next = point; else ask(point);
  }

  /** Klicket eller trycket: rutan läggs in med den valda symbolen; `exact` (Alt+klick) sluter bara glapp upp till grundtoleransen. */
  function tap(point: Point, exact = false) {
    if (proposals.tap(point)) return;
    if (!session || !symbol || symbol.kind !== "area") { input.say(text.needsArea); return; }
    if (filling.current) return;
    filling.current = true;
    hovering.current = { waiting: false, next: undefined };
    session.fill({ point, hidden: input.hidden, diagnose: true, gapM, exact }, result => {
      filling.current = false;
      setPreview(undefined); setBridges([]);
      if (result.status === "open") {
        setGaps(result.gaps);
        input.say(result.gaps.length ? text.openGap(exact ? FILL_GAP_M : Math.max(FILL_GAP_M, gapM), result.gaps.length) : text.openFar(FILL_WINDOW_M));
        return;
      }
      setGaps([]);
      const ok = input.commit({ key: newKey(crypto.randomUUID()), ref: null, kind: "ADD", after: { kind: "OBJECT", object: fillObject(symbol.id, result.rings) } });
      const area = result.areaM2 < 10 ? Math.round(result.areaM2 * 10) / 10 : Math.round(result.areaM2);
      input.say(ok ? text.done(symbol.code, area.toLocaleString(locale), result.closed, bridgeSummary(result.bridges)) : text.notSaved);
    });
  }

  /** Bryggorna i beskedet, t.ex. «1 hörn slutet (3,1 m + 2,2 m)». */
  function bridgeSummary(list: readonly FillBridge[]): string {
    const metres = (value: number) => `${(Math.round(value * 10) / 10).toLocaleString(locale)} m`;
    return (["corner", "extend", "bridge"] as const).flatMap(kind => {
      const of = list.filter(bridge => bridge.kind === kind);
      return of.length ? [text.bridged(kind, of.length, of.map(bridge => bridge.lengthsM.map(metres).join(" + ")).join("; "))] : [];
    }).join(", ");
  }

  /** Rutan under pekaren (i symbolens färg), bryggorna (orange) och öppningarna (röda), ovanpå kartan. */
  function draw(ctx: CanvasRenderingContext2D, view: Viewport) {
    proposals.draw(ctx, view);
    if (!active || (!preview && gaps.length === 0)) return;
    ctx.save();
    if (preview) {
      ctx.beginPath();
      for (const ring of preview) {
        ring.forEach((point, index) => { const at = toScreen(view, point); if (index === 0) ctx.moveTo(at.x, at.y); else ctx.lineTo(at.x, at.y); });
        ctx.closePath();
      }
      ctx.globalAlpha = 0.5; ctx.fillStyle = symbol?.fill ?? "#1a5fd0"; ctx.fill("evenodd"); ctx.globalAlpha = 1;
      ctx.lineWidth = 4; ctx.strokeStyle = "#fff"; ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = "#1a5fd0"; ctx.setLineDash([6, 4]); ctx.stroke();
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

  return { hover, tap, draw, preview, bridges, gaps, proposals, hint: symbol?.kind === "area" ? text.hint(symbol.code, FILL_GAP_M, Math.max(FILL_GAP_M, gapM)) : text.needsArea };
}
