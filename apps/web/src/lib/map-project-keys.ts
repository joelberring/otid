/**
 * Ägaren 2026-11-10: ritlägets tangenter ligger under vänster hand (Q–T, A–G, Z–B) och går att byta själv. En tangent skrivs
 * som den står på tangentbordet ("Q", "Space", "§"), med "Shift+" framför för varianten. Bokstäverna läses ur tangentens
 * plats (`event.code`), så att de är desamma oavsett tangentbordets språk. Cmd/Ctrl+Z och Cmd/Ctrl+Skift+Z gäller alltid.
 */
export const KEY_COMMANDS = ["select", "draw", "circle", "note", "addPoint", "removePoint", "switchSymbol", "simplify", "smooth", "checked",
  "undo", "redo", "wheel", "bare"] as const;
export type KeyCommand = typeof KEY_COMMANDS[number];
export type KeyMap = Readonly<Record<KeyCommand, string>>;

export const DEFAULT_KEYS: KeyMap = {
  select: "Q", draw: "W", circle: "Shift+E", note: "Shift+T",
  addPoint: "A", removePoint: "S", smooth: "Shift+A", simplify: "Shift+S",
  undo: "Z", redo: "Shift+Z", switchSymbol: "C", checked: "R",
  wheel: "Space", bare: "§"
};

export const KEYS_STORAGE = "otid-map-keys";

/** Tangenter som redan betyder något annat i ritläget och inte går att välja. */
const RESERVED = new Set(["Enter", "Escape", "Delete", "Backspace", "Tab", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

/** Tangenttryckningen som en tangent i kartan, eller inget för en ren Skift/Alt och för tryck med Cmd/Ctrl. */
export function bindingOf(event: { key: string; code: string; shiftKey: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): string | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
  const base = letter ?? (event.code === "Space" || event.key === " " ? "Space" : event.key === "`" ? "§" : [...event.key].length === 1 ? event.key.toUpperCase() : event.key);
  if (!base || base === "Shift" || base === "Alt" || base === "Control" || base === "Meta" || base === "Dead" || base === "CapsLock") return undefined;
  return event.shiftKey ? `Shift+${base}` : base;
}

export const isReserved = (binding: string): boolean => RESERVED.has(binding.replace(/^Shift\+/, ""));

export function commandFor(keys: KeyMap, binding: string | undefined): KeyCommand | undefined {
  return binding ? KEY_COMMANDS.find(command => keys[command] === binding) : undefined;
}

/**
 * Ge ett kommando en ny tangent. Hade ett annat kommando den, står det kommandot utan tangent efteråt (`displaced`), så att
 * två kommandon aldrig delar tangent. En reserverad tangent ändrar ingenting.
 */
export function withBinding(keys: KeyMap, command: KeyCommand, binding: string): { keys: KeyMap; displaced?: KeyCommand } {
  if (isReserved(binding)) return { keys };
  const displaced = KEY_COMMANDS.find(other => other !== command && keys[other] === binding);
  return { keys: { ...keys, ...(displaced ? { [displaced]: "" } : {}), [command]: binding }, ...(displaced ? { displaced } : {}) };
}

/** Den sparade uppsättningen: okända kommandon och annat än text hoppas över, och det som saknas får förvalet. */
export function parseKeys(stored: string | null): KeyMap {
  let value: unknown;
  try { value = stored ? JSON.parse(stored) : undefined; } catch { value = undefined; }
  if (!value || typeof value !== "object") return DEFAULT_KEYS;
  const record = value as Record<string, unknown>;
  const out: Record<KeyCommand, string> = { ...DEFAULT_KEYS };
  for (const command of KEY_COMMANDS) {
    const binding = record[command];
    if (typeof binding === "string" && binding.length <= 20 && !isReserved(binding)) out[command] = binding;
  }
  // Två kommandon på samma tangent (en handändrad lagring): det senare tappar sin.
  const seen = new Set<string>();
  for (const command of KEY_COMMANDS) { if (out[command] && seen.has(out[command])) out[command] = ""; seen.add(out[command]); }
  return out;
}

/** Tangenten som den visas: "⇧E", "Mellanslag". */
export function keyLabel(binding: string, space: string): string {
  return binding.replace(/^Shift\+/, "⇧").replace("Space", space);
}
