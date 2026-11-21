import { keyLabel, type KeyCommand, type KeyMap } from "../../lib/map-project-keys";
import { toScreen, type Viewport } from "../../lib/course-setting-viewport";
import type { mapProjectKeysSv } from "../../i18n/map-project-keys-sv";
import type { mapProjectQuickSv } from "../../i18n/map-project-quick-sv";
import type { Texts } from "../../lib/language";
import type { Box } from "@o-tid/map-revision";

export type ContextActionId = "switchSymbol" | "pick" | "duplicate" | "parallel" | "reverse" | "join" | "fill" | "smooth" | "simplify" | "simplifyMore" | "straighten"
  | "checked" | "edge" | "remove";

export interface ContextAction {
  readonly id: ContextActionId; readonly label: string;
  /** Tangenten som den visas («⇧D»), eller inget. */
  readonly key?: string | undefined;
  readonly help?: string | undefined;
  /** Kollad/rekad: knappen är nedtryckt när objektet är kollat. */
  readonly pressed?: boolean | undefined;
  readonly testId?: string | undefined;
}

/** Vad som är markerat och vad som går med det (räknat i editorn). Det som inte går finns inte med i raden alls. */
export interface ContextInput {
  readonly keys: KeyMap; readonly space: string; readonly text: Texts<typeof mapProjectKeysSv>; readonly quick: Texts<typeof mapProjectQuickSv>;
  /** Ett markerat objekt. */
  readonly single?: {
    readonly kind: "point" | "line" | "area" | "text";
    /** Koden för den valda symbolen när det markerade kan byta till den. */
    readonly switchTo: string | undefined;
    /** Det markerade har en annan symbol än den valda (pipetten). */
    readonly canPick: boolean;
    /** Formens åtgärder som ändrar något (förenkla, mjuk, rak). */
    readonly shapes: readonly { readonly id: "simplify" | "simplifyMore" | "smooth" | "straighten"; readonly label: string }[];
    /** Gör yta/kant går med den valda symbolen. */
    readonly canFill: boolean;
    /** En brytpunkt är vald: Ta bort tar bort den. */
    readonly vertex: boolean;
  } | undefined;
  /** Flera markerade. */
  readonly multi?: { readonly count: number; readonly switchable: number; readonly symbolCode: string | undefined; readonly joinable: boolean;
    readonly lines: number; readonly smooth: number; readonly simplify: number } | undefined;
  /** Kollad i terrängen: `undefined` = den som tittar får inte reka. */
  readonly checked?: boolean | undefined;
  /** Kantlinje på markerade ytor med kartans kantsymboler (tomt = ingen kantsymbol, och då finns inte åtgärden). */
  readonly edge?: { readonly areas: number; readonly codes: readonly string[] } | undefined;
}

/**
 * K8b V1 (ägaren 2026-11-21): kontextraden vid det markerade och listan i hjulet. Bara det som går att använda, i fast
 * ordning med «Byt till» den valda symbolen först, och varje knapp med sin tangent. Flera markerade: byt alla, slå ihop,
 * förenkla, duplicera och ta bort (och vänd, mjuk och kant när de går).
 */
export function contextActions(input: ContextInput): ContextAction[] {
  const { keys, text, quick, single, multi } = input;
  const key = (command: KeyCommand) => keys[command] ? keyLabel(keys[command], input.space) : undefined;
  const of = (id: ContextActionId, label: string, command: KeyCommand | undefined, extra: Partial<ContextAction> = {}): ContextAction =>
    ({ id, label, key: command && key(command), help: command && command in text.tips ? text.tips[command as keyof typeof text.tips] : undefined, ...extra });
  const edge = input.edge && input.edge.codes.length ? [of("edge", text.edge(input.edge.areas, input.edge.codes.join(", ")), undefined)] : [];
  const checked = input.checked === undefined ? [] : [of("checked", text.commands.checked, "checked", { pressed: input.checked, testId: "recon-check" })];
  if (multi) return [
    ...(multi.switchable && multi.symbolCode ? [of("switchSymbol", text.multiSwitch(multi.switchable, multi.symbolCode), "switchSymbol", { testId: "map-project-rail-switch" })] : []),
    ...(multi.joinable ? [of("join", text.commands.join, "join", { testId: "map-project-rail-join" })] : []),
    ...(multi.simplify ? [of("simplify", text.multiSimplify(multi.simplify), "simplify")] : []),
    ...(multi.smooth ? [of("smooth", text.multiSmooth(multi.smooth), "smooth")] : []),
    of("duplicate", text.commands.duplicate, "duplicate", { testId: "map-project-duplicate" }),
    ...(multi.lines ? [of("reverse", text.commands.reverse, "reverse", { testId: "map-project-rail-reverse" })] : []),
    ...edge,
    of("remove", text.multiRemove(multi.count), undefined, { key: "Del", help: text.tips.remove, testId: "map-project-rail-remove" })];
  if (!single) return [];
  const shape = (id: "simplify" | "simplifyMore" | "smooth" | "straighten") => {
    const found = single.shapes.find(entry => entry.id === id);
    return found ? [of(id, found.label, id === "simplify" || id === "smooth" ? id : undefined)] : [];
  };
  const line = single.kind === "line";
  return [
    ...(single.switchTo ? [of("switchSymbol", quick.switchTo(single.switchTo), "switchSymbol", { testId: "map-project-rail-switch" })] : []),
    ...(single.canPick ? [of("pick", text.commands.pick, "pick", { testId: "map-project-rail-pick" })] : []),
    of("duplicate", text.commands.duplicate, "duplicate", { testId: "map-project-duplicate" }),
    ...(line ? [of("parallel", text.commands.parallel, "parallel", { testId: "map-project-parallel" })] : []),
    ...(line ? [of("reverse", text.commands.reverse, "reverse", { testId: "map-project-rail-reverse" })] : []),
    ...(single.canFill ? [of("fill", text.commands.fill, "fill", { testId: "map-project-fill" })] : []),
    ...shape("smooth"), ...shape("simplify"), ...shape("simplifyMore"), ...shape("straighten"),
    ...checked,
    ...edge,
    of("remove", single.vertex ? text.commands.removePoint : quick.remove, undefined, { key: "Del", help: text.tips.remove, testId: "map-project-rail-remove" })];
}

/** Avståndet (px) mellan objektets ram och raden, och till kartrutans kant. Flera markerade: utanför hörnens vridzon. */
export const CONTEXT_GAP_PX = 8;
export const CONTEXT_MULTI_GAP_PX = 40;
const EDGE_PX = 4;

/**
 * Var kontextraden ska stå (kartrutans pixlar): ovanför objektets ram, under den om det inte får plats, inom rutan i sidled.
 * Inget när ramen inte syns i rutan.
 */
export function contextPlacement(box: Box, view: Viewport, row: { readonly width: number; readonly height: number },
  gapPx = CONTEXT_GAP_PX): { x: number; y: number } | undefined {
  const a = toScreen(view, { x: box.minX, y: box.maxY }), b = toScreen(view, { x: box.maxX, y: box.minY });
  if (b.x < 0 || a.x > view.width || b.y < 0 || a.y > view.height) return undefined;
  const above = a.y - gapPx - row.height;
  const y = above >= EDGE_PX ? above : Math.min(b.y + gapPx, view.height - row.height - EDGE_PX);
  const x = Math.max(EDGE_PX, Math.min(view.width - row.width - EDGE_PX, a.x));
  return { x, y: Math.max(EDGE_PX, y) };
}
