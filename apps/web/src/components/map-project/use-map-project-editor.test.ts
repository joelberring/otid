import { describe, expect, it } from "vitest";
import { sendBatch } from "./use-map-project-editor";

describe("kön till servern", () => {
  it("skickar högst 200 ändringar och inte mer än servern tar emot, men alltid minst en", () => {
    const small = Array.from({ length: 450 }, (_, index) => ({ id: index }));
    expect(sendBatch(small)).toHaveLength(200);
    const big = Array.from({ length: 10 }, (_, index) => ({ id: index, path: "x".repeat(1000) }));
    expect(sendBatch(big, 3500)).toHaveLength(3);
    expect(sendBatch(big, 10)).toHaveLength(1);
    expect(sendBatch([])).toEqual([]);
  });
});
