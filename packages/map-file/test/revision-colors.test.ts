import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyMapColors, effectiveColorChanges, readMapFile, withColorChanges } from "../src/index";

/** Ägaren 2026-11-10: färgtabellens CMYK kan ändras i kartprojektet och skrivs i den nya kartversionen (Mapper). */
const bytes = new Uint8Array(readFileSync(join(import.meta.dirname, "../../../fixtures/maps/kartfil.omap")));
const map = readMapFile(bytes, "kartfil.omap");
const violet = map.colors.find(color => color.name === "Violett")!;

describe("kartans färgtabell", () => {
  it("byter CMYK och räknar om skärmfärgen; okända färger och oförändrade värden hoppas över", () => {
    const changes = [{ id: violet.id, cmyk: { c: 0.2, m: 1.4, y: 0, k: 0 } }, { id: 9999, cmyk: { c: 1, m: 0, y: 0, k: 0 } },
      { id: map.colors[1]!.id, cmyk: map.colors[1]!.cmyk }];
    expect(effectiveColorChanges(map.colors, changes)).toEqual([{ id: violet.id, cmyk: { c: 0.2, m: 1, y: 0, k: 0 } }]);
    const next = withColorChanges(map.colors, changes);
    expect(next.find(color => color.id === violet.id)!.cmyk).toEqual({ c: 0.2, m: 1, y: 0, k: 0 });
    expect(next.find(color => color.id === violet.id)!.rgb).not.toEqual(violet.rgb);
    expect(next.filter(color => color.id !== violet.id)).toEqual(map.colors.filter(color => color.id !== violet.id));
  });

  it("skriver färgen i Mapper-filen och lämnar allt annat som det var", () => {
    const result = applyMapColors(bytes, [{ id: violet.id, cmyk: { c: 0.2, m: 1, y: 0.05, k: 0 } }]);
    if (!result.ok) throw new Error(result.message);
    expect(result.changed).toBe(1);
    const after = readMapFile(result.bytes, "kartfil.omap");
    expect(after.colors.find(color => color.id === violet.id)!.cmyk).toEqual({ c: 0.2, m: 1, y: 0.05, k: 0 });
    expect(after.colors.filter(color => color.id !== violet.id)).toEqual(map.colors.filter(color => color.id !== violet.id));
    expect(after.objects).toEqual(map.objects);
    expect([...after.symbols]).toEqual([...map.symbols]);
    // Bara färgens rad skiljer filerna åt.
    const lines = (data: Uint8Array) => new TextDecoder().decode(data).split("\n");
    const differing = lines(result.bytes).filter((line, index) => line !== lines(bytes)[index]);
    expect(differing).toHaveLength(1);
    expect(differing[0]).toContain('name="Violett" c="0.2" m="1" y="0.05" k="0"');
  });

  it("inga ändringar ger samma bytes, och en OCAD-fil vägras", () => {
    expect(applyMapColors(bytes, [])).toEqual({ ok: true, bytes, changed: 0 });
    const same = applyMapColors(bytes, [{ id: violet.id, cmyk: violet.cmyk }]);
    expect(same.ok && same.bytes).toBe(bytes);
    const ocd = applyMapColors(new Uint8Array([0xad, 0x0c, 0, 0]), [{ id: 1, cmyk: { c: 1, m: 0, y: 0, k: 0 } }]);
    expect(ocd).toMatchObject({ ok: false });
  });
});
