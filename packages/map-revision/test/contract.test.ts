import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyMapRevision, readMapFile, sha256Hex, type MapObject } from "@o-tid/map-file";
import { objectRefFor, parseObjectRef, toChangeSet, type ObjectChange } from "../src";

/** ADR-0219: adaptern till skrivaren. Bara det som skiljer går till skrivaren, och satsen går att skriva på den riktiga fixturen. */
const bytes = new Uint8Array(readFileSync(new URL("../../../fixtures/maps/kartfil.omap", import.meta.url)));
const sha = sha256Hex(bytes);
const map = readMapFile(bytes, "kartfil.omap", { sources: true });
const point = map.objects.find(object => object.kind === "point") as Extract<MapObject, { kind: "point" }>;
const line = map.objects.find(object => object.kind === "line")!;
const meta = { author: "a", at: "2026-11-07T20:00:00.000Z" };

describe("toChangeSet", () => {
  it("tar bara med det som skiljer och hoppar över ändringar som inte ändrar något", () => {
    const ref = objectRefFor(sha, point)!;
    const changes: ObjectChange[] = [
      { kind: "MODIFY", ref, object: { ...point, at: { x: point.at.x + 1, y: point.at.y } }, ...meta },
      { kind: "MODIFY", ref: objectRefFor(sha, line)!, object: line, ...meta }
    ];
    const set = toChangeSet(map, sha, "OMAP", changes);
    expect(set.changes).toHaveLength(1);
    expect(set.changes[0]).toMatchObject({ kind: "modify", geometry: { kind: "point" } });
    expect(set.changes[0]).not.toHaveProperty("symbol");
    const written = applyMapRevision(bytes, set);
    expect(written.ok && written.report.modified).toBe(1);
  });

  it("läser bara giltiga referenser ur lagrad JSON", () => {
    const ref = objectRefFor(sha, point)!;
    expect(parseObjectRef(JSON.parse(JSON.stringify(ref)))).toEqual(ref);
    expect(parseObjectRef({ ...ref, locator: { ...ref.locator, extra: 1 } })).toBeUndefined();
    expect(parseObjectRef({ ...ref, fileSha256: "x" })).toBeUndefined();
  });
});
