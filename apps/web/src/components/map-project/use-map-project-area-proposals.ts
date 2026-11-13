"use client";

import { useMemo, useRef, useState } from "react";
import type { Point } from "@o-tid/map-file";
import { isSprintNorm, mapNorm, newKey } from "@o-tid/map-revision";
import { mapProjectFillEn } from "../../i18n/map-project-fill-en";
import { mapProjectFillSv } from "../../i18n/map-project-fill-sv";
import { toMap, toScreen, type Viewport } from "../../lib/course-setting-viewport";
import { candidateAt, type AreaCandidate } from "../../lib/map-project-area-proposals";
import { fillObject } from "../../lib/map-project-fill-area";
import type { CatalogSymbol, MapProjectSession } from "../../lib/map-project-protocol";
import { useLocale, useTexts } from "../language-provider";
import type { ObjectChange } from "./use-map-project-editor";

const BLUE = "#1a5fd0", ORANGE = "#e8590c";

/**
 * Ägaren 2026-11-13 («ytor är särskilt svårt»): Föreslå ytor på sprintkartor, en del av verktyget Fyll yta. Knappen i raden
 * under kartan tar fram de slutna, ofyllda rutorna i det som syns på skärmen (räknas i Workern,
 * `map-project-area-proposals.ts`) och visar dem som ett överlägg: rutor med förslag fyllda i den föreslagna symbolens färg
 * med numret i, rutor utan förslag streckade, osäkra rutor (stora eller med slutet glapp) streckade i orange. Ett klick på en
 * ruta lägger in den med förslaget (eller med den valda symbolen: när rutan saknar förslag, eller när kryssrutan säger att
 * den valda symbolen går före); «Lägg in alla med förslag» lägger in dem som en ändring som Ångra tar bort på en gång.
 * Reglerna träffar bara ungefär sex av tio ytor rätt i mätningen, därför läggs inget in utan kartritarens klick.
 */
export function useMapProjectAreaProposals(input: { session: MapProjectSession | undefined; active: boolean;
  /** Den valda symbolen i listan. */
  symbol: CatalogSymbol | undefined; symbols: ReadonlyMap<string, CatalogSymbol>; scale: number | undefined; hidden: readonly string[];
  commit: (change: ObjectChange) => boolean; commitMany: (changes: readonly ObjectChange[]) => number; say: (message: string) => void }) {
  const text = useTexts(mapProjectFillSv, mapProjectFillEn).propose;
  const locale = useLocale();
  const { session, symbols, scale } = input;
  const sprint = useMemo(() => isSprintNorm(mapNorm({ scale, symbols: symbols.values() })), [scale, symbols]);
  const [candidates, setCandidates] = useState<readonly AreaCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  /** Det senaste svaret: hur många rutor som fanns (före taket) och hur många som redan var fyllda. */
  const [found, setFound] = useState<{ found: number; filled: number }>();
  const [message, setMessage] = useState<string>();
  const [override, setOverride] = useState(false);
  /** Vyn som senast ritades: rutan som «det som syns på skärmen» räknas ur. */
  const view = useRef<Viewport>(undefined);
  const available = input.active && sprint;
  const chosen = input.symbol?.kind === "area" ? input.symbol : undefined;
  const add = (candidate: AreaCandidate, symbol: string): ObjectChange =>
    ({ key: newKey(crypto.randomUUID()), ref: null, kind: "ADD", after: { kind: "OBJECT", object: fillObject(symbol, candidate.rings) } });

  function run() {
    const current = view.current;
    if (!session || !current || busy) return;
    const a = toMap(current, { x: 0, y: current.height }), b = toMap(current, { x: current.width, y: 0 });
    setBusy(true); setMessage(undefined);
    session.proposeAreas({ box: { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) }, hidden: input.hidden }, result => {
      setBusy(false);
      if (result.status !== "done") { setCandidates([]); setFound(undefined); setMessage(result.status === "tooLarge" ? text.tooLarge : text.notSprint); return; }
      setCandidates(result.candidates); setFound({ found: result.found, filled: result.filled });
      setMessage(result.candidates.length === 0 ? text.none(result.filled) : undefined);
    });
  }

  /** Klicket: ligger punkten i en kandidat läggs den in. Sant när klicket är omhändertaget. */
  function tap(point: Point): boolean {
    if (!available) return false;
    const index = candidateAt(candidates, point);
    if (index < 0) return false;
    const candidate = candidates[index]!;
    const symbol = (override ? chosen : undefined) ?? (candidate.symbol ? symbols.get(candidate.symbol) : undefined) ?? chosen;
    if (!symbol) { input.say(text.needsSymbol); return true; }
    if (!input.commit(add(candidate, symbol.id))) return true;
    setCandidates(list => list.filter(row => row !== candidate));
    const area = Math.round(candidate.areaM2);
    input.say(text.added(symbol.code, area.toLocaleString(locale)));
    return true;
  }

  const suggested = candidates.filter(candidate => candidate.symbol && symbols.has(candidate.symbol));
  function acceptAll() {
    if (suggested.length === 0) return;
    const count = input.commitMany(suggested.map(candidate => add(candidate, candidate.symbol!)));
    if (count === 0) return;
    setCandidates(list => list.filter(row => !suggested.includes(row)));
    input.say(text.addedAll(count));
  }
  const clear = () => { setCandidates([]); setFound(undefined); setMessage(undefined); };

  /** Överlägget: kandidaterna ovanpå kartan. */
  function draw(ctx: CanvasRenderingContext2D, current: Viewport) {
    view.current = current;
    if (!available || candidates.length === 0) return;
    ctx.save();
    ctx.font = "600 12px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const candidate of candidates) {
      const symbol = candidate.symbol ? symbols.get(candidate.symbol) : undefined;
      ctx.beginPath();
      for (const ring of candidate.rings) {
        ring.forEach((point, index) => { const at = toScreen(current, point); if (index === 0) ctx.moveTo(at.x, at.y); else ctx.lineTo(at.x, at.y); });
        ctx.closePath();
      }
      if (symbol) { ctx.globalAlpha = 0.55; ctx.fillStyle = symbol.fill ?? BLUE; ctx.fill("evenodd"); ctx.globalAlpha = 1; }
      ctx.setLineDash([]); ctx.lineWidth = 3.5; ctx.strokeStyle = "#fff"; ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = candidate.uncertain ? ORANGE : BLUE; ctx.setLineDash(symbol ? [] : [5, 4]); ctx.stroke();
      // Numret (eller ett frågetecken) när rutan är stor nog på skärmen att rymma det.
      if (Math.sqrt(candidate.areaM2) * 1000 / (scale ?? 4000) * current.pxPerMm < 26) continue;
      const at = toScreen(current, candidate.at), label = symbol?.code ?? "?";
      ctx.setLineDash([]); ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.strokeText(label, at.x, at.y);
      ctx.fillStyle = candidate.uncertain ? ORANGE : "#12306b"; ctx.fillText(label, at.x, at.y);
    }
    ctx.restore();
  }

  return { available, busy, candidates, suggested: suggested.length, uncertain: candidates.filter(candidate => candidate.uncertain).length, found, message,
    override, setOverride, chosen, run, tap, acceptAll, clear, draw, inCandidate: (point: Point) => available && candidateAt(candidates, point) >= 0 };
}
