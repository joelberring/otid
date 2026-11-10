import { keyLabel, type KeyMap } from "../../lib/map-project-keys";
import type { mapProjectKeysSv } from "../../i18n/map-project-keys-sv";
import type { Texts } from "../../lib/language";
import type { RailTool } from "./map-project-tool-rail";
import type { WheelTool } from "./map-project-tool-wheel";

export interface RailState {
  readonly keys: KeyMap; readonly text: Texts<typeof mapProjectKeysSv>;
  readonly labels: { readonly panel: string; readonly select: string; readonly selectHelp: string; readonly draw: string; readonly drawHelp: string; readonly circle: string;
    readonly area: string; readonly note: string; readonly undo: string; readonly redo: string; readonly checked: string; readonly switchTo: string | undefined };
  readonly tool: string; readonly panelOpen: boolean; readonly bare: boolean;
  readonly canEdit: boolean; readonly canDecide: boolean; readonly canNote: boolean; readonly canCheck: boolean; readonly isChecked: boolean;
  readonly canUndo: boolean; readonly canRedo: boolean;
  /** Något är markerat (ett objekt eller flera), och vad som går att göra med det. */
  readonly hasSelection: boolean; readonly canSwitch: boolean; readonly canJoin: boolean; readonly canSmooth: boolean; readonly canSimplify: boolean;
  readonly pick: (tool: "select" | "draw" | "circle" | "addPoint" | "removePoint" | "area" | "note") => void;
  readonly act: (command: "switchSymbol" | "join" | "smooth" | "simplify" | "checked") => void;
  readonly remove: () => void; readonly undo: () => void; readonly redo: () => void;
  readonly togglePanel: () => void; readonly toggleBare: () => void; readonly openWheel: () => void; readonly openKeys: () => void;
}

/**
 * Ägaren 2026-11-10 («en symbol för alla snabbkommandon så att man kan välja tangentbord eller symbol», «en förklaring när man
 * drar med musen över»): verktygsspaltens knappar. Tre grupper: verktygen (vad ett klick på kartan gör), det som görs med det
 * markerade, och ångra, hjulet, bara kartan och tangenterna. Det som inte går just nu är grått och förklaringen säger varför.
 */
export function railTools(state: RailState): RailTool[] {
  const { keys, text, labels } = state, key = (command: keyof KeyMap) => keys[command] ? keyLabel(keys[command], "␣") : undefined;
  const needs = state.hasSelection ? undefined : text.needSelection;
  return [
    { id: "panel", label: labels.panel, icon: "panel", active: state.panelOpen, phoneOnly: true, onPick: state.togglePanel },
    ...(state.canEdit ? [
      { id: "select", label: labels.select, icon: "select", key: key("select"), help: labels.selectHelp, active: state.tool === "select", onPick: () => state.pick("select") },
      { id: "draw", label: labels.draw, icon: "draw", key: key("draw"), help: labels.drawHelp, active: state.tool === "draw", onPick: () => state.pick("draw") },
      { id: "circle", label: labels.circle, icon: "circle", key: key("circle"), help: text.tips.circle, active: state.tool === "circle", testId: "map-project-circle-tool",
        onPick: () => state.pick("circle") },
      { id: "addPoint", label: text.commands.addPoint, icon: "addPoint", key: key("addPoint"), help: text.addPointHint, gap: true, active: state.tool === "addPoint",
        testId: "map-project-add-point", onPick: () => state.pick("addPoint") },
      { id: "removePoint", label: text.commands.removePoint, icon: "removePoint", key: key("removePoint"), help: text.removePointHint, active: state.tool === "removePoint",
        testId: "map-project-remove-point", onPick: () => state.pick("removePoint") },
      ...(state.canDecide ? [{ id: "area", label: labels.area, icon: "area", help: text.tips.area, active: state.tool === "area", onPick: () => state.pick("area") } as const] : []),
      ...(state.canNote ? [{ id: "note", label: labels.note, icon: "note", key: key("note"), help: text.tips.note, active: state.tool === "note", testId: "map-project-note-tool",
        onPick: () => state.pick("note") } as const] : []),
      { id: "switchSymbol", label: labels.switchTo ?? text.commands.switchSymbol, icon: "switchSymbol", key: key("switchSymbol"), help: text.tips.switchSymbol, gap: true,
        disabled: !state.canSwitch, disabledHelp: needs ?? text.needOtherSymbol, testId: "map-project-rail-switch", onPick: () => state.act("switchSymbol") },
      { id: "join", label: text.commands.join, icon: "join", key: key("join"), help: text.tips.join, disabled: !state.canJoin, disabledHelp: text.needLines,
        testId: "map-project-rail-join", onPick: () => state.act("join") },
      { id: "smooth", label: text.commands.smooth, icon: "smooth", key: key("smooth"), help: text.tips.smooth, disabled: !state.canSmooth, disabledHelp: text.needShape,
        onPick: () => state.act("smooth") },
      { id: "simplify", label: text.commands.simplify, icon: "simplify", key: key("simplify"), help: text.tips.simplify, disabled: !state.canSimplify, disabledHelp: text.needShape,
        onPick: () => state.act("simplify") },
      ...(state.canCheck ? [{ id: "checked", label: labels.checked, icon: "checked", key: key("checked"), help: text.tips.checked, active: state.isChecked,
        disabled: !state.hasSelection, disabledHelp: text.needSelection, onPick: () => state.act("checked") } as const] : []),
      { id: "remove", label: text.remove, icon: "remove", key: "Del", help: text.tips.remove, disabled: !state.hasSelection, disabledHelp: text.needSelection,
        testId: "map-project-rail-remove", onPick: state.remove },
      { id: "undo", label: labels.undo, icon: "undo", key: key("undo"), help: text.tips.undo, gap: true, pin: "first", disabled: !state.canUndo, onPick: state.undo },
      { id: "redo", label: labels.redo, icon: "redo", key: key("redo"), pin: "second", disabled: !state.canRedo, onPick: state.redo },
      { id: "wheel", label: text.commands.wheel, icon: "wheel", key: key("wheel"), help: text.tips.wheel, gap: true, desktopOnly: true, onPick: state.openWheel }
    ] satisfies RailTool[] : []),
    { id: "bare", label: text.commands.bare, icon: "bare", key: key("bare"), help: text.tips.bare, active: state.bare, desktopOnly: true, gap: !state.canEdit, onPick: state.toggleBare },
    { id: "keys", label: text.open, icon: "keys", help: text.tips.keys, desktopOnly: true, testId: "map-project-keys-open", onPick: state.openKeys }
  ];
}

/** Hjulets verktyg: samma som spaltens första grupp. */
export function wheelToolsOf(keys: KeyMap, space: string, labels: { readonly select: string; readonly draw: string; readonly circle: string; readonly note: string },
  tool: string, canNote: boolean, pick: (tool: "select" | "draw" | "circle" | "note") => void): WheelTool[] {
  return (["select", "draw", "circle", ...(canNote ? ["note" as const] : [])] as const).map(id =>
    ({ id, label: labels[id], icon: id, key: keyLabel(keys[id], space), active: tool === id, onPick: () => pick(id) }));
}
