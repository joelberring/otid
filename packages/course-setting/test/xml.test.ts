import { describe, expect, it } from "vitest";
import { parseXml, textOf } from "../src/xml";
import { CourseSettingEditError } from "../src/types";

const invalid = expect.objectContaining({ code: "INVALID" }) as Error;

describe("parseXml: gränser (översynen 2026-11-22)", () => {
  it("avkodar giltiga teckenreferenser", () => {
    expect(textOf(parseXml("<a>&#229;&#xE4;&#x1F600;&amp;</a>").root)).toBe("åä😀&");
  });

  it("ger INVALID, inte RangeError, för ogiltiga kodpunkter", () => {
    for (const reference of ["&#999999999;", "&#x110000;", "&#xD800;", "&#0;", "&#99999999999999999999;"]) {
      expect(() => parseXml(`<a>${reference}</a>`), reference).toThrow(invalid);
      expect(() => parseXml(`<a b="${reference}"/>`), reference).toThrow(CourseSettingEditError);
    }
  });

  it("ger INVALID för djupt nästlad XML i stället för att stacken tar slut", () => {
    const depth = 100_000;
    expect(() => parseXml("<a>".repeat(depth) + "</a>".repeat(depth))).toThrow(invalid);
    const fine = 20;
    expect(parseXml("<a>".repeat(fine) + "</a>".repeat(fine)).root.name).toBe("a");
  });
});
