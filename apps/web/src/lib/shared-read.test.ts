import { describe, expect, it } from "vitest";
import { createSharedRead } from "./shared-read";

describe("steg 54: delad läsning för flera skärmar", () => {
  it("räknar en gång per nyckel och ttl, delar en pågående uträkning och delar inte ett fel", async () => {
    let now = 0, computed = 0;
    const shared = createSharedRead(2_000, () => now);
    const compute = async () => { computed += 1; return computed; };
    expect(await Promise.all([shared("a", compute), shared("a", compute), shared("b", compute)])).toEqual([1, 1, 2]);
    now = 1_999;
    expect(await shared("a", compute)).toBe(1);
    now = 2_000;
    expect(await shared("a", compute)).toBe(3);
    await expect(shared("c", async () => { throw new Error("nej"); })).rejects.toThrow("nej");
    expect(await shared("c", compute)).toBe(4);
  });
});
