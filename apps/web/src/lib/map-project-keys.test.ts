import { describe, expect, it } from "vitest";
import { bindingOf, commandFor, DEFAULT_KEYS, KEY_COMMANDS, keyLabel, parseKeys, withBinding } from "./map-project-keys";

const press = (code: string, key: string, extra: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
  bindingOf({ code, key, shiftKey: false, ...extra });

describe("ritlägets tangenter", () => {
  it("förvalet ligger under vänster hand och ingen tangent används två gånger", () => {
    const bindings = KEY_COMMANDS.map(command => DEFAULT_KEYS[command]);
    expect(new Set(bindings).size).toBe(bindings.length);
    const letters = bindings.map(binding => binding.replace(/^Shift\+/, "")).filter(key => key.length === 1 && key !== "§");
    expect(letters.every(letter => "QWERTASDFGZXCVB".includes(letter))).toBe(true);
  });

  it("läser bokstaven ur tangentens plats, med Skift som variant", () => {
    expect(press("KeyQ", "q")).toBe("Q");
    expect(press("KeyE", "E", { shiftKey: true })).toBe("Shift+E");
    // Ett annat tangentbordsspråk ger ett annat tecken men samma plats.
    expect(press("KeyQ", "й")).toBe("Q");
    expect(press("Space", " ")).toBe("Space");
    expect(press("Backquote", "§")).toBe("§");
    expect(press("Backquote", "`")).toBe("§");
  });

  it("Cmd, Ctrl och Alt och en ensam Skift ger ingen tangent", () => {
    expect(press("KeyW", "w", { metaKey: true })).toBeUndefined();
    expect(press("KeyZ", "z", { ctrlKey: true })).toBeUndefined();
    expect(press("KeyC", "c", { altKey: true })).toBeUndefined();
    expect(press("ShiftLeft", "Shift", { shiftKey: true })).toBeUndefined();
  });

  it("hittar kommandot för en tangent", () => {
    expect(commandFor(DEFAULT_KEYS, "Q")).toBe("select");
    expect(commandFor(DEFAULT_KEYS, "Shift+S")).toBe("simplify");
    expect(commandFor(DEFAULT_KEYS, "X")).toBeUndefined();
    expect(commandFor(DEFAULT_KEYS, undefined)).toBeUndefined();
  });

  it("en ny tangent tar tangenten från kommandot som hade den", () => {
    const result = withBinding(DEFAULT_KEYS, "draw", "Q");
    expect(result.keys.draw).toBe("Q");
    expect(result.keys.select).toBe("");
    expect(result.displaced).toBe("select");
    expect(withBinding(DEFAULT_KEYS, "draw", "P")).toEqual({ keys: { ...DEFAULT_KEYS, draw: "P" } });
  });

  it("reserverade tangenter går inte att välja", () => {
    expect(withBinding(DEFAULT_KEYS, "draw", "Enter").keys).toBe(DEFAULT_KEYS);
    expect(withBinding(DEFAULT_KEYS, "draw", "3").keys).toBe(DEFAULT_KEYS);
    expect(withBinding(DEFAULT_KEYS, "draw", "Shift+Delete").keys).toBe(DEFAULT_KEYS);
  });

  it("läser en sparad uppsättning försiktigt", () => {
    expect(parseKeys(null)).toBe(DEFAULT_KEYS);
    expect(parseKeys("inte json")).toBe(DEFAULT_KEYS);
    expect(parseKeys(JSON.stringify({ draw: "P", okänt: "X", select: 7, undo: "Enter" }))).toEqual({ ...DEFAULT_KEYS, draw: "P" });
    // Samma tangent två gånger: det senare kommandot tappar sin.
    expect(parseKeys(JSON.stringify({ draw: "Q" }))).toEqual({ ...DEFAULT_KEYS, draw: "" });
    expect(parseKeys(JSON.stringify({ select: "" })).select).toBe("");
  });

  it("visar tangenten kort", () => {
    expect(keyLabel("Shift+E", "Mellanslag")).toBe("⇧E");
    expect(keyLabel("Space", "Mellanslag")).toBe("Mellanslag");
  });
});
