"use client";

import { useEffect, useRef, type RefObject } from "react";
import { applyEdit, routeHintKey, routeHintOf, type RouteHint } from "@o-tid/course-setting";
import { applyBackground, type EditorState } from "../../lib/course-setting-editor";
import type { RouteChoiceSession } from "../../lib/route-choice-client";

/** Högst så många sträckor i en ändring (`SET_ROUTE_HINTS` i kontrakten). */
const PER_EDIT = 200;
const WAIT_MS = 2500;

/**
 * Ägaren 2026-11-08: kontrollnumren ska inte ligga på de troliga vägvalen. Varje sträcka som vägvalens Worker räknar (vald
 * sträcka, banans längd, förbjudna områden) ger vägarna nära kontrollerna; de sparas i dokumentet en stund senare, utan att
 * hamna i ångra-historiken, så att numren i förhandsvisningen och i PDF:en från servern läggs utanför dem.
 */
export function useRouteHints(input: { session: RefObject<RouteChoiceSession | undefined>; ready: boolean; enabled: boolean;
  edit: (change: (current: EditorState) => EditorState) => void }) {
  const { session, ready, enabled } = input;
  const edit = useRef(input.edit);
  edit.current = input.edit;
  useEffect(() => {
    const worker = session.current;
    if (!ready || !worker || !enabled) return;
    const pending = new Map<string, RouteHint>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      if (pending.size === 0) return;
      const found = [...pending];
      pending.clear();
      edit.current(current => {
        const known = current.document.event.routeHints ?? {};
        const changed = found.filter(([key, hint]) => JSON.stringify(known[key]) !== JSON.stringify(hint)).slice(0, PER_EDIT);
        return changed.length > 0 ? applyBackground(current, { type: "SET_ROUTE_HINTS", hints: Object.fromEntries(changed) }, applyEdit) : current;
      });
    };
    const stop = worker.listen((leg, analysis) => {
      if (!analysis.best) return;
      const hint = routeHintOf([analysis.best.points, ...analysis.alternatives.map(route => route.points)]);
      if (!hint) return;
      // Kontrollernas egna lägen (vägens ändar är avrundade), så att vägen gäller tills någon av dem flyttas.
      pending.set(routeHintKey(leg.from, leg.to), { ...hint, from: leg.from, to: leg.to });
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, WAIT_MS);
    });
    return () => { stop(); if (timer) clearTimeout(timer); flush(); };
  }, [session, ready, enabled]);
}
