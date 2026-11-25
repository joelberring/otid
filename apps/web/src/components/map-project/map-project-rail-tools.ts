import type { MapObject } from "@o-tid/map-file";
import { keyLabel, type KeyMap } from "../../lib/map-project-keys";
import { measureObject } from "../../lib/map-project-shape-tools";
import type { mapProjectEditorSv } from "../../i18n/map-project-editor-sv";
import type { mapProjectKeysSv } from "../../i18n/map-project-keys-sv";
import type { mapProjectNotesSv } from "../../i18n/map-project-notes-sv";
import type { mapProjectQuickSv } from "../../i18n/map-project-quick-sv";
import type { Texts } from "../../lib/language";
import type { RailTool } from "./map-project-tool-rail";
import type { WheelTool } from "./map-project-tool-wheel";

type RailPick = "select" | "draw" | "circle" | "rectangle" | "bucket" | "text" | "addPoint" | "removePoint" | "cut" | "area" | "note";

export interface RailState {
  readonly keys: KeyMap; readonly text: Texts<typeof mapProjectKeysSv>;
  readonly labels: { readonly panel: string; readonly select: string; readonly selectHelp: string; readonly draw: string; readonly drawHelp: string; readonly circle: string;
    readonly area: string; readonly note: string; readonly undo: string; readonly redo: string };
  readonly tool: string; readonly panelOpen: boolean; readonly bare: boolean;
  readonly canEdit: boolean; readonly canDecide: boolean; readonly canNote: boolean;
  readonly canUndo: boolean; readonly canRedo: boolean;
  /** K8b V5: Visa ofyllda rutor är på. */
  readonly unfilled: boolean; readonly toggleUnfilled: () => void;
  readonly pick: (tool: RailPick) => void;
  readonly undo: () => void; readonly redo: () => void;
  readonly togglePanel: () => void; readonly toggleBare: () => void; readonly openWheel: () => void; readonly openKeys: () => void;
}

/**
 * Ägaren 2026-11-10 («en symbol för alla snabbkommandon») och K8b V1 (2026-11-21): verktygsspalten har bara verktyg, i
 * grupper med en liten rubrik: Markera | Rita, Rektangel, Cirkel, Text (K8b V6) | Fyll | Forma | Granska (V5: Visa ofyllda rutor); längst ned hjulet, bara kartan och
 * tangenterna. Det som görs med det markerade står i kontextraden vid objektet (`map-project-context-actions.ts`), och Ångra
 * och Gör om i raden överst (i telefonen ligger de kvar fästa i spaltens rad).
 */
export function railTools(state: RailState): RailTool[] {
  const { keys, text, labels } = state, key = (command: keyof KeyMap) => keys[command] ? keyLabel(keys[command], "␣", text.section) : undefined;
  const tool = (id: Exclude<RailPick, "area">, icon: RailTool["icon"], label: string, help: string, extra: Partial<RailTool> = {}): RailTool =>
    ({ id, label, icon, key: key(id), help, active: state.tool === id, onPick: () => state.pick(id), ...extra });
  const review: RailTool[] = [
    ...(state.canNote ? [tool("note", "note", labels.note, text.tips.note, { testId: "map-project-note-tool" })] : []),
    ...(state.canDecide ? [{ id: "area", label: labels.area, icon: "area", help: text.tips.area, active: state.tool === "area", onPick: () => state.pick("area") } as const] : []),
    { id: "unfilled", label: text.commands.unfilled, icon: "unfilled", key: key("unfilled"), help: text.tips.unfilled, active: state.unfilled, desktopOnly: true,
      testId: "map-project-unfilled", onPick: state.toggleUnfilled }
  ];
  return [
    { id: "panel", label: labels.panel, icon: "panel", active: state.panelOpen, phoneOnly: true, onPick: state.togglePanel },
    ...(state.canEdit ? [
      tool("select", "select", labels.select, labels.selectHelp),
      tool("draw", "draw", labels.draw, labels.drawHelp, { group: text.groups.draw }),
      tool("rectangle", "rectangle", text.commands.rectangle, text.tips.rectangle, { testId: "map-project-rectangle-tool" }),
      tool("circle", "circle", labels.circle, text.tips.circle, { testId: "map-project-circle-tool" }),
      tool("text", "text", text.commands.text, text.tips.text, { testId: "map-project-text-tool" }),
      tool("bucket", "bucket", text.commands.bucket, text.tips.bucket, { group: text.groups.fill, testId: "map-project-bucket-tool" }),
      tool("addPoint", "addPoint", text.commands.addPoint, text.addPointHint, { group: text.groups.shape, testId: "map-project-add-point" }),
      tool("removePoint", "removePoint", text.commands.removePoint, text.removePointHint, { testId: "map-project-remove-point" }),
      tool("cut", "cut", text.commands.cut, text.tips.cut, { testId: "map-project-cut" }),
      ...review.map((entry, index) => index === 0 ? { ...entry, group: text.groups.review } : entry),
      // Telefonen: Ångra och Gör om ligger kvar vid radens högra kant (i datorn står de i raden överst).
      { id: "undo", label: labels.undo, icon: "undo", key: key("undo"), help: text.tips.undo, phoneOnly: true, pin: "first", disabled: !state.canUndo, onPick: state.undo },
      { id: "redo", label: labels.redo, icon: "redo", key: key("redo"), phoneOnly: true, pin: "second", disabled: !state.canRedo, onPick: state.redo },
      { id: "wheel", label: text.commands.wheel, icon: "wheel", key: key("wheel"), help: text.tips.wheel, desktopOnly: true, bottom: true, onPick: state.openWheel }
    ] satisfies RailTool[] : []),
    { id: "bare", label: text.commands.bare, icon: "bare", key: key("bare"), help: text.tips.bare, active: state.bare, desktopOnly: true, bottom: true, onPick: state.toggleBare },
    { id: "keys", label: text.open, icon: "keys", help: text.tips.keys, desktopOnly: true, bottom: true, testId: "map-project-keys-open", onPick: state.openKeys }
  ];
}

/** Hjulets fasta platser medurs från norr (K8b V1): N, NO, O, SO, S, SV, V, NV. */
export const WHEEL_SLOTS = ["select", "draw", "rectangle", "bucket", "repeat", "cut", "point", "note"] as const;
export type WheelSlotId = typeof WHEEL_SLOTS[number];

/** Platsen (0 = norr, medurs) för en rörelse på skärmen (y nedåt). */
export function wheelDirection(dx: number, dy: number): number {
  return ((Math.round((Math.atan2(dy, dx) * 180 / Math.PI + 90) / 45) % 8) + 8) % 8;
}

/**
 * Hjulets åtta platser (K8b V1). Platserna flyttar aldrig: får man inte skriva notiser är NV tom, och Gör igen är grå tills
 * det finns något att göra igen. Punkt väljer Lägg till punkt, och ett klick till när det redan är valt Ta bort punkt.
 */
export function wheelToolsOf(input: { keys: KeyMap; space: string; tool: string; canNote: boolean;
  labels: { readonly select: string; readonly draw: string; readonly rectangle: string; readonly fill: string; readonly repeat: string; readonly cut: string;
    readonly point: string; readonly note: string };
  help?: Partial<Record<WheelSlotId, string>>; repeat: string | undefined;
  pick: (tool: "select" | "draw" | "rectangle" | "bucket" | "cut" | "addPoint" | "removePoint" | "note") => void; onRepeat: () => void }): (WheelTool | undefined)[] {
  const { keys, space, tool, labels } = input, help = input.help ?? {};
  const label = (command: keyof KeyMap) => keys[command] ? keyLabel(keys[command], space) : "";
  return WHEEL_SLOTS.map((id): WheelTool | undefined => {
    if (id === "note" && !input.canNote) return undefined;
    if (id === "repeat") return { id, label: input.repeat ?? labels.repeat, icon: "repeat", key: label("repeat"), help: help.repeat, active: false, disabled: !input.repeat, onPick: input.onRepeat };
    if (id === "point") return { id, label: labels.point, icon: tool === "addPoint" ? "removePoint" : "addPoint", key: label("addPoint"), help: help.point,
      active: tool === "addPoint" || tool === "removePoint", onPick: () => input.pick(tool === "addPoint" ? "removePoint" : "addPoint") };
    const icon = id === "bucket" ? "bucket" : id;
    const name = id === "bucket" ? labels.fill : labels[id];
    return { id, label: name, icon, key: label(id), help: help[id], active: tool === id, onPick: () => input.pick(id) };
  });
}

/** Raden under kartan: vad det valda verktyget gör (utbrutet ur `map-project-editor.tsx`). */
export function toolHint(input: { canEdit: boolean; closed: boolean; tool: string; multiCount: number; rotating: boolean;
  symbol: { readonly code: string; readonly kind: string } | undefined; text: Texts<typeof mapProjectEditorSv>; notes: Texts<typeof mapProjectNotesSv>;
  keys: Texts<typeof mapProjectKeysSv>; quick: Texts<typeof mapProjectQuickSv>;
  /** K8b V6: textverktygets rad (också Rita med en textsymbol). */
  textHint: string }): string {
  const { tool, symbol, text, keys, quick } = input;
  return !input.canEdit ? (input.closed ? text.closed : text.readOnly)
    : tool === "text" || (tool === "draw" && symbol?.kind === "text") ? input.textHint
    : tool === "area" ? text.collab.areaHint
    : tool === "note" ? input.notes.toolHint
    : tool === "rectangle" ? keys.rectangleHint(0)
    : tool === "addPoint" ? keys.addPointHint : tool === "removePoint" ? keys.removePointHint : tool === "cut" ? keys.cutHint
    : tool === "select" && input.multiCount ? (input.rotating ? keys.multiRotate : keys.multiSelected(input.multiCount))
    : tool === "select" ? text.hints.select
    : !symbol ? text.tools.noSymbol
    : tool === "circle" ? (symbol.kind === "line" || symbol.kind === "area" ? quick.circleHint(symbol.code) : quick.circleNeedsShape)
    : symbol.kind === "point" ? text.hints.drawPoint(symbol.code)
    : symbol.kind === "line" ? text.hints.drawLine(symbol.code)
    : text.hints.drawArea(symbol.code);
}

/** Det valda verktygets namn först i raden under kartan. */
export function toolName(tool: string, quick: Texts<typeof mapProjectQuickSv>, keys: Texts<typeof mapProjectKeysSv>): string | undefined {
  return ({ select: quick.tools.select, draw: quick.tools.draw, circle: quick.tools.circle, cut: quick.tools.cut, text: keys.commands.text, note: quick.tools.note,
    rectangle: keys.commands.rectangle, bucket: keys.commands.bucket, addPoint: keys.commands.addPoint, removePoint: keys.commands.removePoint } as Partial<Record<string, string>>)[tool];
}

/** Det markerade under kartan: symbolen och, för en linje eller yta, längden eller ytan i terrängen. */
export function selectionLabel(symbol: { readonly code: string; readonly name: string }, object: MapObject | undefined, scale: number | undefined,
  text: Texts<typeof mapProjectKeysSv>): string {
  const measured = object && scale ? measureObject(object, scale) : undefined;
  return `${symbol.code} ${symbol.name} · ${measured ? `${text.measured(measured)} · ` : ""}`;
}
