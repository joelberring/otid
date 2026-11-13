"use client";

import { useEffect, useRef, useState } from "react";
import type { Point } from "@o-tid/map-file";
import { newKey } from "@o-tid/map-revision";
import { mapProjectFillEn } from "../../i18n/map-project-fill-en";
import { mapProjectFillSv } from "../../i18n/map-project-fill-sv";
import { toScreen, type Viewport } from "../../lib/course-setting-viewport";
import { FILL_GAP_M, FILL_WINDOW_M, fillObject } from "../../lib/map-project-fill-area";
import type { CatalogSymbol, MapProjectSession } from "../../lib/map-project-protocol";
import { useLocale, useTexts } from "../language-provider";
import type { ObjectChange } from "./use-map-project-editor";

/**
 * Ägaren 2026-11-13 («fylla ytor»; sprintkartans ytor): verktyget Fyll yta. Med en ytsymbol vald visar pekaren rutan som
 * kartans synliga linjer och ytkanter bildar under den (räknas i Workern, `map-project-fill-area.ts`), och ett klick eller
 * ett tryck med fingret lägger in den som en vanlig ändring (ett förslag för den som bara får föreslå; Ångra tar bort den).
 * Är rutan inte sluten sägs varför, och öppningarna som hittas ritas röda.
 */
export function useMapProjectFill(input: { session: MapProjectSession | undefined; active: boolean; symbol: CatalogSymbol | undefined;
  /** Släckta symboler: de är inga gränser. */
  hidden: readonly string[]; commit: (change: ObjectChange) => boolean; say: (message: string) => void }) {
  const text = useTexts(mapProjectFillSv, mapProjectFillEn);
  const locale = useLocale();
  const { session, active, symbol } = input;
  const [preview, setPreview] = useState<Point[][]>();
  const [gaps, setGaps] = useState<readonly (readonly [Point, Point])[]>([]);
  /** Pekarens frågor går en i taget: `waiting` är frågan som är ute, `next` punkten som väntar på tur. */
  const hovering = useRef<{ waiting: boolean; next: Point | undefined }>({ waiting: false, next: undefined });
  /** Ett klick är på väg: pekaren frågar inte under tiden (bara det senaste svaret kommer fram). */
  const filling = useRef(false);
  const usable = active && symbol?.kind === "area";
  useEffect(() => { if (!usable) { setPreview(undefined); setGaps([]); hovering.current.next = undefined; } }, [usable]);

  function ask(point: Point) {
    if (!session) return;
    hovering.current = { waiting: true, next: undefined };
    session.fill({ point, hidden: input.hidden, diagnose: false }, result => {
      const next = hovering.current.next;
      hovering.current.waiting = false;
      setPreview(result.status === "found" ? result.rings : undefined);
      if (next) ask(next);
    });
  }

  /** Pekaren över kartan (musen): rutan under den visas. */
  function hover(point: Point | undefined) {
    if (!usable || filling.current) return;
    if (!point) { hovering.current.next = undefined; setPreview(undefined); return; }
    if (hovering.current.waiting) hovering.current.next = point; else ask(point);
  }

  /** Klicket eller trycket: rutan läggs in med den valda symbolen. */
  function tap(point: Point) {
    if (!session || !symbol || symbol.kind !== "area") { input.say(text.needsArea); return; }
    if (filling.current) return;
    filling.current = true;
    hovering.current = { waiting: false, next: undefined };
    session.fill({ point, hidden: input.hidden, diagnose: true }, result => {
      filling.current = false;
      setPreview(undefined);
      if (result.status === "open") {
        setGaps(result.gaps);
        input.say(result.gaps.length ? text.openGap(FILL_GAP_M, result.gaps.length) : text.openFar(FILL_WINDOW_M));
        return;
      }
      setGaps([]);
      const ok = input.commit({ key: newKey(crypto.randomUUID()), ref: null, kind: "ADD", after: { kind: "OBJECT", object: fillObject(symbol.id, result.rings) } });
      const area = result.areaM2 < 10 ? Math.round(result.areaM2 * 10) / 10 : Math.round(result.areaM2);
      input.say(ok ? text.done(symbol.code, area.toLocaleString(locale), result.closed) : text.notSaved);
    });
  }

  /** Rutan under pekaren (i symbolens färg) och öppningarna (röda), ovanpå kartan. */
  function draw(ctx: CanvasRenderingContext2D, view: Viewport) {
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

  return { hover, tap, draw, preview, gaps, hint: symbol?.kind === "area" ? text.hint(symbol.code, FILL_GAP_M) : text.needsArea };
}
