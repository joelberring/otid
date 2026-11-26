import { describe, expect, it } from "vitest";
import { bufferView, ifNoneMatchSha256, matchesIfNoneMatch } from "./http-etag";

describe("http-etag (RFC 9110 §13.1.2)", () => {
  it("normaliserar svaga W/-ETags, kommaseparerade listor och *", () => {
    expect(matchesIfNoneMatch('"abc"', '"abc"')).toBe(true);
    expect(matchesIfNoneMatch('W/"abc"', '"abc"')).toBe(true);
    expect(matchesIfNoneMatch('"abc"', 'W/"abc"')).toBe(true);
    expect(matchesIfNoneMatch('W/"abc"', 'W/"abc"')).toBe(true);
    expect(matchesIfNoneMatch('"other", W/"abc", "third"', '"abc"')).toBe(true);
    expect(matchesIfNoneMatch('"a,b", W/"c,d"', '"c,d"')).toBe(true);
    expect(matchesIfNoneMatch("*", '"abc"')).toBe(true);
    expect(matchesIfNoneMatch('"other", *', '"abc"')).toBe(true);

    // W/ är skiftlägeskänsligt enligt RFC 9110 §8.8.3; okvoterade värden och tomma rubriker matchar aldrig.
    expect(matchesIfNoneMatch('w/"abc"', '"abc"')).toBe(false);
    expect(matchesIfNoneMatch("abc", '"abc"')).toBe(false);
    expect(matchesIfNoneMatch('"ab"', '"abc"')).toBe(false);
    expect(matchesIfNoneMatch("", '"abc"')).toBe(false);
    expect(matchesIfNoneMatch(null, '"abc"')).toBe(false);
    expect(matchesIfNoneMatch(undefined, '"abc"')).toBe(false);
    expect(matchesIfNoneMatch('"abc"', "abc")).toBe(false);
  });

  it("extraherar SHA-256 ur starka och svaga If-None-Match-rubriker", () => {
    const sha = "a".repeat(64);
    const sha2 = "b".repeat(64);
    expect(ifNoneMatchSha256(`"${sha}"`)).toBe(sha);
    expect(ifNoneMatchSha256(`W/"${sha}"`)).toBe(sha);
    expect(ifNoneMatchSha256(`"inte-sha", W/"${sha}", "${sha2}"`)).toBe(sha);
    expect(ifNoneMatchSha256("*")).toBeUndefined();
    expect(ifNoneMatchSha256(`"${"A".repeat(64)}"`)).toBeUndefined();
    expect(ifNoneMatchSha256(null)).toBeUndefined();
  });

  it("skapar en zero-copy Uint8Array-vy över Buffer inklusive slice", () => {
    const whole = Buffer.from([10, 20, 30, 40, 50]);
    const slice = whole.subarray(1, 4);
    const view = bufferView(slice);
    expect(view.buffer).toBe(slice.buffer);
    expect(view.byteOffset).toBe(slice.byteOffset);
    expect(view.byteLength).toBe(3);
    expect([...view]).toEqual([20, 30, 40]);
  });
});
