/**
 * Ägaren 2026-11-10: ritlägets tangenter ligger under vänster hand (Q–T, A–G, Z–B) och går att byta själv. En tangent skrivs
 * som den står på tangentbordet ("Q", "Space", "§"), med "Shift+" framför för varianten. Bokstäverna läses ur tangentens
 * plats (`event.code`), så att de är desamma oavsett tangentbordets språk. Cmd/Ctrl+Z och Cmd/Ctrl+Skift+Z gäller alltid.
 */
export const KEY_COMMANDS = ["select", "draw", "rectangle", "circle", "bucket", "addPoint", "removePoint", "cut", "note", "switchSymbol", "pick", "reverse", "join", "simplify", "smooth", "checked", "duplicate", "fill", "parallel",
  "repeat", "snap", "undo", "redo", "wheel", "bare", "unfilled"] as const;
export type KeyCommand = typeof KEY_COMMANDS[number];
export type KeyMap = Readonly<Record<KeyCommand, string>>;

/**
 * Förvalet. K8b V1 (ägaren 2026-11-21): F magisk fyll, G koppla ihop, E rektangel, T fäst och ⇧Mellanslag gör igen; håll Q
 * för att tillfälligt markera (`use-map-project-shortcuts.ts`). K8b V5: ⇧§ visar ofyllda rutor.
 */
export const DEFAULT_KEYS: KeyMap = {
  select: "Q", draw: "W", rectangle: "E", circle: "Shift+E", bucket: "F", note: "Shift+T", duplicate: "Shift+D", fill: "Shift+F", parallel: "Shift+V",
  addPoint: "A", removePoint: "S", cut: "X", pick: "D", reverse: "V", smooth: "Shift+A", simplify: "Shift+S",
  undo: "Z", redo: "Shift+Z", switchSymbol: "C", join: "G", checked: "R", snap: "T", repeat: "Shift+Space",
  wheel: "Space", bare: "§", unfilled: "Shift+§"
};

/**
 * Förvalet före 2026-11-21. Dialogen sparade då hela uppsättningen, så en sparad tangent som är lika med det gamla förvalet
 * räknas inte som egen: den får det nya förvalet.
 */
const LEGACY_DEFAULTS: Partial<KeyMap> = {
  select: "Q", draw: "W", circle: "Shift+E", rectangle: "Shift+W", bucket: "G", note: "Shift+T", duplicate: "Shift+D", fill: "Shift+F", parallel: "Shift+V",
  addPoint: "A", removePoint: "S", cut: "X", pick: "D", reverse: "V", smooth: "Shift+A", simplify: "Shift+S",
  undo: "Z", redo: "Shift+Z", switchSymbol: "C", join: "F", checked: "R", wheel: "Space", bare: "§"
};

export const KEYS_STORAGE = "otid-map-keys";

/**
 * Tangenter som redan betyder något annat i ritläget och inte går att välja: 1–8 väljer de senaste symbolerna (Alt+0–6
 * normens grupper), [ och ] ändrar Glapp.
 */
const RESERVED = new Set(["Enter", "Escape", "Delete", "Backspace", "Tab", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "[", "]"]);

/** §-tangenten med och utan Skift (svenskt tangentbord: ° på Mac, ½ i Windows; ` och ~ på amerikanskt). */
const SECTION_KEYS = new Set(["§", "°", "½", "`", "~"]);

/** Tangenttryckningen som en tangent i kartan, eller inget för en ren Skift/Alt och för tryck med Cmd/Ctrl. */
export function bindingOf(event: { key: string; code: string; shiftKey: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): string | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
  const base = letter ?? (event.code === "Space" || event.key === " " ? "Space" : SECTION_KEYS.has(event.key) ? "§" : [...event.key].length === 1 ? event.key.toUpperCase() : event.key);
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

/**
 * Den sparade uppsättningen: okända kommandon och annat än text hoppas över, och det som saknas får förvalet. Sparade egna
 * tangenter går före förvalet: krockar ett förval med en egen tangent står kommandot utan tangent.
 */
export function parseKeys(stored: string | null): KeyMap {
  let value: unknown;
  try { value = stored ? JSON.parse(stored) : undefined; } catch { value = undefined; }
  if (!value || typeof value !== "object") return DEFAULT_KEYS;
  const versioned = (value as { v?: unknown }).v === 2 && typeof (value as { keys?: unknown }).keys === "object";
  const record = (versioned ? (value as { keys: unknown }).keys ?? {} : value) as Record<string, unknown>;
  const own = new Map<KeyCommand, string>();
  for (const command of KEY_COMMANDS) {
    const binding = record[command];
    if (typeof binding !== "string" || binding.length > 20 || isReserved(binding)) continue;
    if (!versioned && LEGACY_DEFAULTS[command] === binding) continue;
    if (binding !== DEFAULT_KEYS[command]) own.set(command, binding);
  }
  if (own.size === 0) return DEFAULT_KEYS;
  const out: Record<KeyCommand, string> = { ...DEFAULT_KEYS };
  const seen = new Set<string>();
  // De egna först (samma tangent två gånger i en handändrad lagring: det senare tappar sin), sedan förvalen som inte krockar.
  for (const [command, binding] of own) { out[command] = binding && seen.has(binding) ? "" : binding; if (binding) seen.add(binding); }
  for (const command of KEY_COMMANDS) {
    if (own.has(command)) continue;
    if (seen.has(out[command])) out[command] = ""; else seen.add(out[command]);
  }
  return out;
}

/** Det som sparas: bara det som skiljer sig från förvalet, så att ett nytt förval når den som inte valt själv. */
export function serializeKeys(keys: KeyMap): string {
  const own: Partial<Record<KeyCommand, string>> = {};
  for (const command of KEY_COMMANDS) if (keys[command] !== DEFAULT_KEYS[command]) own[command] = keys[command];
  return JSON.stringify({ v: 2, keys: own });
}

/** Tangenten som den visas: "⇧E", "Mellanslag". */
export function keyLabel(binding: string, space: string): string {
  return binding.replace(/^Shift\+/, "⇧").replace("Space", space);
}
