import { afterAll, describe, expect, it } from "vitest";
import type { MapProjectRequest, MapProjectResponse } from "./map-project-protocol";

function buildOmapXml(objectCount: number): ArrayBuffer {
  const objects: string[] = [];
  for (let i = 0; i < objectCount; i += 1) {
    const x = (i % 50) * 1000;
    const y = Math.floor(i / 50) * 1000;
    objects.push(`<object type="1" symbol="0"><coords count="2">${x} ${y};${x + 500} ${y};</coords></object>`);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<map xmlns="http://openorienteering.org/apps/mapper/xml/v2" version="9">
<georeferencing scale="10000"><ref_point x="0" y="0"/></georeferencing>
<colors count="1">
<color priority="0" name="Brun" c="0" m="0.56" y="1" k="0.18" opacity="1"><cmyk method="custom"/><rgb method="custom" r="0.82" g="0.36" b="0"/></color>
</colors>
<barrier version="6" required="0.6.0">
<symbols count="3" id="test">
<symbol type="2" id="2" code="506.0" name="Stig"><line_symbol color="0" line_width="180" dashed="true" dash_length="2000" break_length="500" dashes_in_group="1"/></symbol>
<symbol type="2" id="0" code="103.0" name="Hjälpkurva"><line_symbol color="0" line_width="100" dashed="true" dash_length="2000" break_length="400" dashes_in_group="1"/></symbol>
<symbol type="2" id="1" code="101.0" name="Höjdkurva"><line_symbol color="0" line_width="140"/></symbol>
</symbols>
<parts count="1" current="0">
<part name="Karta"><objects count="${objectCount}">
${objects.join("\n")}
</objects></part>
</parts>
<templates count="0" first_front_template="0"/>
</barrier>
</map>`;
  const encoded = new TextEncoder().encode(xml);
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
}

describe("map-project-worker (Etapp P3)", () => {
  const prevSelf = (globalThis as Record<string, unknown>).self;
  const prevOffscreen = (globalThis as Record<string, unknown>).OffscreenCanvas;

  afterAll(() => {
    if (prevSelf === undefined) delete (globalThis as Record<string, unknown>).self;
    else (globalThis as Record<string, unknown>).self = prevSelf;
    if (prevOffscreen === undefined) delete (globalThis as Record<string, unknown>).OffscreenCanvas;
    else (globalThis as Record<string, unknown>).OffscreenCanvas = prevOffscreen;
  });

  it("använder O(1) keyIndex vid markeringsruta, återanvänder baseBoxes vid states och parallelliserar symbolikon-PNG i catalog", async () => {
    const responses: MapProjectResponse[] = [];
    let onCatalogDone: ((res: MapProjectResponse) => void) | undefined;
    const fakeSelf: { onmessage?: (event: MessageEvent<MapProjectRequest>) => void; postMessage: (msg: MapProjectResponse) => void } = {
      postMessage(msg) {
        responses.push(msg);
        if (msg.type === "catalog" && msg.id === 4) onCatalogDone?.(msg);
      }
    };
    let inFlight = 0;
    let maxInFlight = 0;
    const noopCtx = new Proxy({}, {
      get: (_target, prop) => (prop === "measureText" ? () => ({ width: 0 }) : () => undefined),
      set: () => true
    });
    class MockOffscreenCanvas {
      width: number;
      height: number;
      constructor(width: number, height: number) { this.width = width; this.height = height; }
      getContext() { return noopCtx; }
      async convertToBlob(): Promise<Blob> {
        inFlight += 1;
        if (inFlight > maxInFlight) maxInFlight = inFlight;
        await new Promise(resolve => setTimeout(resolve, 10));
        inFlight -= 1;
        return new Blob(["png"], { type: "image/png" });
      }
    }
    (globalThis as Record<string, unknown>).self = fakeSelf;
    (globalThis as Record<string, unknown>).OffscreenCanvas = MockOffscreenCanvas;

    await import("./map-project-worker");
    const send = (data: MapProjectRequest) => fakeSelf.onmessage?.({ data } as MessageEvent<MapProjectRequest>);

    // 1. Ladda karta med 2 500 objekt.
    send({ type: "load", bytes: buildOmapXml(2500), fileName: "test.omap", sha256: "a".repeat(64) });
    const loaded = responses.find(r => r.type === "loaded");
    expect(loaded).toBeDefined();
    if (!loaded || loaded.type !== "loaded") return;
    expect(loaded.objects).toBe(2500);

    // 2. Markeringsruta som träffar 2 000 objekt: snabb O(1)-uppslagning via keyIndex.
    const t0 = performance.now();
    send({ type: "box", id: 1, box: { minX: -10, minY: -100, maxX: 100, maxY: 100 }, hidden: [] });
    const boxMs = performance.now() - t0;
    const boxRes = responses.find(r => r.type === "box" && r.id === 1);
    expect(boxRes?.type).toBe("box");
    if (boxRes?.type === "box") {
      expect(boxRes.hits).toHaveLength(2000);
      expect(boxMs).toBeLessThan(500);
      // 3. Uppdatera 1 basobjekt + lägg till 1 nytt objekt: orörda baseBoxes återanvänds och ändringar får färska rutor.
      const firstKey = boxRes.hits[0]!.key;
      const newObjKey = "n:00000000-0000-4000-8000-000000000001";
      send({
        type: "states",
        states: [
          [firstKey, { ref: boxRes.hits[0]!.ref, state: { kind: "OBJECT", object: { kind: "line", symbol: "0", path: [{ type: "M", x: 500, y: 500 }, { type: "L", x: 501, y: 500 }] } } }],
          [newObjKey, { ref: null, state: { kind: "OBJECT", object: { kind: "line", symbol: "1", path: [{ type: "M", x: 600, y: 600 }, { type: "L", x: 601, y: 600 }] } } }]
        ]
      });
      send({ type: "hit", id: 2, point: { x: 500.5, y: 500 }, tolerance: 0.5, hidden: [] });
      send({ type: "hit", id: 3, point: { x: 600.5, y: 600 }, tolerance: 0.5, hidden: [] });
      const hitMod = responses.find(r => r.type === "hit" && r.id === 2);
      const hitNew = responses.find(r => r.type === "hit" && r.id === 3);
      expect(hitMod?.type === "hit" && hitMod.hits[0]?.key).toBe(firstKey);
      expect(hitNew?.type === "hit" && hitNew.hits[0]?.key).toBe(newObjKey);
    }

    // 4. catalog() parallelliserar convertToBlob (alla 3 symboler samtidigt) och bevarar svensk numerisk sorteringsordning.
    const catPromise = new Promise<MapProjectResponse>(resolve => { onCatalogDone = resolve; });
    send({ type: "catalog", id: 4 });
    const catRes = await catPromise;
    expect(catRes.type).toBe("catalog");
    if (catRes.type === "catalog") {
      expect(catRes.symbols.map(s => s.code)).toEqual(["101.0", "103.0", "506.0"]);
      expect(catRes.symbols.every(s => s.icon instanceof Blob)).toBe(true);
      expect(maxInFlight).toBe(3);
    }
  });
});
