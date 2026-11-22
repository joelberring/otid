"use client";

import { useState } from "react";
import type { MapObject } from "@o-tid/map-file";
import { withSymbol, type EditKind, type ObjectKey, type ObjectRef, type VertexAddress } from "@o-tid/map-revision";
import type { mapProjectKeysSv } from "../../i18n/map-project-keys-sv";
import type { mapProjectQuickSv } from "../../i18n/map-project-quick-sv";
import { edgePlan } from "../../lib/map-project-edge";
import { reverseLine } from "../../lib/map-project-join";
import type { KeyMap } from "../../lib/map-project-keys";
import type { Texts } from "../../lib/language";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { shapeActions } from "../../lib/map-project-shape-actions";
import { fillOrBorder } from "../../lib/map-project-shape-tools";
import { addEdges, duplicateObjects, shapeCommand } from "./map-project-click-tools";
import { contextActions, type ContextActionId } from "./map-project-context-actions";
import type { ObjectChange } from "./use-map-project-editor";
import type { useMapProjectMulti } from "./use-map-project-multi";
import type { useMapProjectRecon } from "./use-map-project-recon";
import type { SelectedCommand } from "./use-map-project-shortcuts";

interface Selected { readonly key: ObjectKey; readonly ref: ObjectRef | null; readonly object: MapObject }

/**
 * K8b V1 (ägaren 2026-11-21): det som går att göra med det markerade, utbrutet ur `map-project-editor.tsx`. Ger kontextradens
 * och hjulets lista (bara det som går), åtgärden för en knapp eller tangent, och Gör igen: den senaste åtgärden (utom pipetten
 * och kollad) körs en gång till på det som är markerat nu.
 */
export function useMapProjectActions(input: {
  canEdit: boolean; tool: string; keys: KeyMap; keysText: Texts<typeof mapProjectKeysSv>; quick: Texts<typeof mapProjectQuickSv>;
  multi: ReturnType<typeof useMapProjectMulti>; selected: Selected | undefined; symbol: CatalogSymbol | undefined; symbolId: string | undefined;
  activeVertex: VertexAddress | undefined; recon: ReturnType<typeof useMapProjectRecon>; symbols: ReadonlyMap<string, CatalogSymbol>; catalog: readonly CatalogSymbol[];
  save: (key: ObjectKey, ref: ObjectRef | null, object: MapObject | undefined, kind: EditKind) => boolean;
  reshape: (result: MapObject | undefined, message: string) => void; commit: (change: ObjectChange) => boolean; setFlash: (message: string) => void;
  chooseSymbol: (id: string) => void; removeSelected: () => void; joinMm: number;
  /** K8b V6: textobjektets åtgärder (Redigera text, Vrid, Ändra textsymbol). */
  text: { labels: { edit: string; rotate: string; style: string; switchTo: (code: string) => string }; edit: () => void; rotate: () => void; style: () => void };
}) {
  const { canEdit, tool, keysText, multi, selected, symbol, recon, setFlash } = input;
  const [last, setLast] = useState<{ id: ContextActionId; label: string }>();
  const canSwitch = !!selected && !!symbol && symbol.id !== selected.object.symbol && symbol.kind === selected.object.kind && canEdit;
  // Ägaren 2026-11-09: formens åtgärder för det markerade objektet.
  const shapes = selected && tool === "select" && canEdit ? shapeActions(selected.object, input.quick) : [];
  // Ägaren 2026-11-15: kantlinje på de markerade ytorna, med kantsymbolen ur kartans symboler.
  const edgeOf = multi.items.length ? multi.items.map(item => item.object) : selected && tool === "select" ? [selected.object] : [];
  const edges = canEdit && edgeOf.some(object => object.kind === "area") ? edgePlan(edgeOf, input.symbols, input.catalog, symbol) : undefined;
  const multiSwitch = symbol && canEdit ? multi.switchable(symbol) : 0;
  const single = selected && !multi.items.length ? selected : undefined;
  const contextList = !canEdit || tool !== "select" ? [] : contextActions({ keys: input.keys, space: keysText.space, text: keysText, quick: input.quick, edge: edges,
    multi: multi.items.length ? { count: multi.items.length, switchable: multiSwitch, symbolCode: symbol?.code, joinable: multi.joinable(input.joinMm),
      lines: multi.items.filter(item => item.object.kind === "line").length, smooth: multi.shapeable("smooth"), simplify: multi.shapeable("simplify") } : undefined,
    single: single ? { kind: single.object.kind, switchTo: canSwitch ? symbol.code : undefined, canPick: single.object.symbol !== input.symbolId,
      shapes: shapes.filter(action => action.result), canFill: !!symbol && !!fillOrBorder(single.object, symbol),
      vertex: !!input.activeVertex && single.object.kind !== "point" && single.object.kind !== "text",
      ...(single.object.kind === "text" ? { text: input.text.labels } : {}) } : undefined,
    checked: single && recon.canRecord ? recon.validChecks.has(single.key) : undefined });

  const duplicate = (items: readonly { object: MapObject }[]) => setFlash(keysText.duplicated(duplicateObjects(items, input.commit)));
  const act = (command: SelectedCommand) => {
    if (multi.items.length) {
      if (command === "switchSymbol" && symbol && multiSwitch) setFlash(keysText.switched(multi.switchSymbol(symbol), symbol.code));
      else if (command === "join") { const count = multi.join(input.joinMm); setFlash(count ? keysText.joined(count) : keysText.needLines); }
      else if (command === "reverse") { const count = multi.reverse(); setFlash(count ? keysText.reversed(count) : keysText.needLine); }
      else if (command === "duplicate") duplicate(multi.items);
      else if (command === "smooth" || command === "simplify") { const count = multi.shape(command); setFlash(count ? keysText[command === "smooth" ? "multiSmoothed" : "multiSimplified"](count) : keysText.needShape); }
      return;
    }
    if (!selected) return;
    const shape = command === "simplify" || command === "smooth" ? shapes.find(action => action.id === command) : undefined;
    if (shape) input.reshape(shape.result, shape.message);
    else if (command === "switchSymbol" && canSwitch) input.save(selected.key, selected.ref, withSymbol(selected.object, symbol.id), "SYMBOL");
    else if (command === "reverse") { const turned = reverseLine(selected.object); if (turned && input.save(selected.key, selected.ref, turned, "RESHAPE")) setFlash(keysText.reversed(1)); }
    else if (command === "duplicate") duplicate([selected]);
    else if (command === "fill" || command === "parallel") setFlash(shapeCommand(command, selected.object, symbol, input.commit, keysText));
    else if (command === "pick") { input.chooseSymbol(selected.object.symbol); setFlash(keysText.picked(input.symbols.get(selected.object.symbol)?.code ?? "")); }
    else if (command === "checked" && recon.canRecord) void recon.setChecked([selected.key], !recon.validChecks.has(selected.key));
  };
  const remember = (id: ContextActionId) => {
    if (id !== "pick" && id !== "checked" && id !== "editText" && id !== "textStyle") setLast({ id, label: contextList.find(action => action.id === id)?.label ?? id });
  };
  const doAction = (id: ContextActionId) => {
    if (id === "edge") { if (edges) setFlash(addEdges(edges, input.commit, keysText)); }
    else if (id === "editText") input.text.edit();
    else if (id === "rotate") input.text.rotate();
    else if (id === "textStyle") input.text.style();
    else if (id === "remove") { if (multi.items.length) multi.remove(); else input.removeSelected(); }
    else if (id === "simplifyMore" || id === "straighten") { const shape = shapes.find(action => action.id === id); if (shape) input.reshape(shape.result, shape.message); }
    else act(id);
    remember(id);
  };
  /** En tangent för det markerade: som förut (med beskedet när den inte går), och Gör igen när den gick. */
  const keyAction = (command: SelectedCommand) => { act(command); if (contextList.some(action => action.id === command)) remember(command); };
  const repeat = () => {
    if (!last) setFlash(keysText.nothingToRepeat);
    else if (contextList.some(action => action.id === last.id)) doAction(last.id);
    else if (last.id !== "edge" && last.id !== "remove" && last.id !== "simplifyMore" && last.id !== "straighten" && last.id !== "rotate"
      && last.id !== "editText" && last.id !== "textStyle") act(last.id);
    else setFlash(keysText.needSelection);
  };
  const repeatLabel = last ? keysText.repeatOf(contextList.find(action => action.id === last.id)?.label ?? last.label) : undefined;
  return { contextList, doAction, keyAction, repeat, repeatLabel };
}
