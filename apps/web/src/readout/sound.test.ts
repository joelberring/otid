import { describe, expect, it } from "vitest";
import { loadSoundEnabled, saveSoundEnabled, soundForVerdict, soundTones } from "./sound";

/** Steg 35: ljud vid avläsning. */
describe("ljud vid avläsning", () => {
  it("glad treklang i dur uppåt vid godkänt, moll nedåt vid fel och stigande fråga vid okänd bricka, under 0,4 s", () => {
    for (const kind of ["ok", "fail", "unknown", "neutral"] as const) {
      const tones = soundTones(kind);
      const last = tones.at(-1)!;
      expect(last.start + last.duration).toBeLessThan(0.4);
    }
    const ratio = (tones: ReturnType<typeof soundTones>, index: number) => tones[index]!.frequency / tones[0]!.frequency;
    const major = soundTones("ok");
    expect(major[1]!.frequency).toBeGreaterThan(major[0]!.frequency);
    expect(ratio(major, 1)).toBeCloseTo(2 ** (4 / 12), 2); // stor ters
    const minor = soundTones("fail");
    expect(minor[1]!.frequency).toBeLessThan(minor[0]!.frequency);
    expect(minor[2]!.frequency * 2 ** (3 / 12)).toBeCloseTo(minor[1]!.frequency, 0); // liten ters i botten
    const unknown = soundTones("unknown");
    expect(unknown).toHaveLength(2);
    expect(unknown[1]!.frequency).toBeGreaterThan(unknown[0]!.frequency);
  });

  it("väljer ljud efter beskedet", () => {
    expect(soundForVerdict("OK")).toBe("ok");
    expect(soundForVerdict("UNKNOWN_CARD")).toBe("unknown");
    for (const status of ["MP", "OVERTIME", "DNF", "FAILED"]) expect(soundForVerdict(status)).toBe("fail");
    expect(soundForVerdict("NO_PACKAGE")).toBe("neutral");
    expect(soundForVerdict(undefined)).toBeUndefined();
  });

  it("valet sparas per webbläsare och är på när inget är sparat eller lagringen är blockerad", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(loadSoundEnabled(storage)).toBe(true);
    saveSoundEnabled(false, storage);
    expect(loadSoundEnabled(storage)).toBe(false);
    const blocked = { getItem: () => { throw new Error("blockerad"); }, setItem: () => { throw new Error("blockerad"); } };
    expect(loadSoundEnabled(blocked)).toBe(true);
    expect(() => saveSoundEnabled(true, blocked)).not.toThrow();
  });
});
