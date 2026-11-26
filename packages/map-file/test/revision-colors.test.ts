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

  it("inga ändringar ger samma bytes, en avkortad OCAD-fil vägras, och en riktig OCAD-fil ändrar färg med rundtur", () => {
    expect(applyMapColors(bytes, [])).toEqual({ ok: true, bytes, changed: 0 });
    const same = applyMapColors(bytes, [{ id: violet.id, cmyk: violet.cmyk }]);
    expect(same.ok && same.bytes).toBe(bytes);
    const brokenOcd = applyMapColors(new Uint8Array([0xad, 0x0c, 0, 0]), [{ id: 1, cmyk: { c: 1, m: 0, y: 0, k: 0 } }]);
    expect(brokenOcd).toMatchObject({ ok: false });

    const ocdBytes = new Uint8Array(readFileSync(join(import.meta.dirname, "../../../fixtures/maps/kartfil.ocd")));
    const ocdBefore = readMapFile(ocdBytes, "kartfil.ocd");
    const ocdViolet = ocdBefore.colors.find(color => color.name === "Violett")!;
    const ocdResult = applyMapColors(ocdBytes, [{ id: ocdViolet.id, cmyk: { c: 0.2, m: 0.95, y: 0.05, k: 0 } }]);
    if (!ocdResult.ok) throw new Error(ocdResult.message);
    expect(ocdResult.changed).toBe(1);
    const ocdAfter = readMapFile(ocdResult.bytes, "kartfil.ocd");
    expect(ocdAfter.colors.find(color => color.id === ocdViolet.id)!.cmyk).toEqual({ c: 0.2, m: 0.95, y: 0.05, k: 0 });
    expect(ocdAfter.colors.filter(color => color.id !== ocdViolet.id)).toEqual(ocdBefore.colors.filter(color => color.id !== ocdViolet.id));
    expect(ocdAfter.objects).toHaveLength(ocdBefore.objects.length);
  });

  it("kan redigera CMYK på dekorfärger i en Mapper-karta med 100 % spotfärger och bevarar <spotcolors> rent i XML", () => {
    const spotOmap = `<?xml version="1.0" encoding="UTF-8"?>
<map xmlns="http://openorienteering.org/apps/mapper/xml/v2" version="9">
<georeferencing scale="10000"/>
<colors count="3">
<color priority="0" name="Svart" c="0" m="0" y="0" k="1" opacity="1"><spotcolors><namedcolor>BLACK</namedcolor></spotcolors><cmyk method="custom"/><rgb method="cmyk" r="0" g="0" b="0"/></color>
<color priority="1" name="Grå 50 %" c="0" m="0" y="0" k="0.5" opacity="1"><spotcolors knockout="true"><component factor="0.5" spotcolor="0"/></spotcolors><cmyk method="spotcolor"/><rgb method="cmyk" r="0.5" g="0.5" b="0.5"/></color>
<color priority="2" name="Brun" c="0" m="0.56" y="1" k="0.18" opacity="1"><spotcolors><namedcolor>BROWN</namedcolor></spotcolors><cmyk method="custom"/><rgb method="cmyk" r="0.82" g="0.36" b="0"/></color>
</colors>
<barrier version="6" required="0.6.0"><symbols count="1"><symbol type="2" id="0" code="101" name="Kurva"><line_symbol color="2" line_width="140"/></symbol></symbols>
<parts count="1" current="0"><part name="del"><objects count="0"/></part></parts></barrier>
</map>`;
    const spotBytes = new TextEncoder().encode(spotOmap);
    const beforeSpot = readMapFile(spotBytes, "spot.omap");
    expect(beforeSpot.colors.every(color => !!color.spot)).toBe(true);

    // Ändra både namngiven dekorfärg (Svart, som Grå 50 % refererar till via spotcolor="0") och en skärmad dekorfärg (Grå 50 %).
    const edited = applyMapColors(spotBytes, [
      { id: 0, cmyk: { c: 0.1, m: 0, y: 0, k: 0.95 } },
      { id: 1, cmyk: { c: 0, m: 0, y: 0, k: 0.65 } }
    ]);
    if (!edited.ok) throw new Error(edited.message);
    expect(edited.changed).toBe(2);
    const xml = new TextDecoder().decode(edited.bytes);
    expect(xml).toContain("<spotcolors><namedcolor>BLACK</namedcolor></spotcolors>");
    expect(xml).toContain('<spotcolors knockout="true"><component factor="0.5" spotcolor="0"/></spotcolors>');
    expect(xml).toContain("<spotcolors><namedcolor>BROWN</namedcolor></spotcolors>");

    const afterSpot = readMapFile(edited.bytes, "spot.omap");
    expect(afterSpot.colors[0]!.cmyk).toEqual({ c: 0.1, m: 0, y: 0, k: 0.95 });
    expect(afterSpot.colors[0]!.spot).toMatchObject({ name: "BLACK", overprint: true });
    expect(afterSpot.colors[1]!.cmyk).toEqual({ c: 0, m: 0, y: 0, k: 0.65 });
    expect(afterSpot.colors[1]!.spot).toMatchObject({ name: "BLACK 50 %", overprint: false, separations: [{ name: "BLACK", factor: 0.5 }] });
    expect(afterSpot.colors[2]).toEqual(beforeSpot.colors[2]);
  });
});
