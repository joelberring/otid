import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, toCsv } from "../src";

describe("CSV för Excel (gemensam för alla CSV-filer)", () => {
  it("BOM, semikolon, CRLF och citering", () => {
    expect(toCsv(["Namn", "Klubb"], [["Ada; Ek", "OK \"Ek\""], [null, 7]])).toBe(`${CSV_BOM}Namn;Klubb\r\n"Ada; Ek";"OK ""Ek"""\r\n;7\r\n`);
  });

  it("text som Excel skulle tolka som formel får en apostrof först; tal lämnas", () => {
    for (const value of ["=SUMMA(A1)", "+1", "-1", "@A1", "\tA", "\rA"]) expect(csvCell(value).replace(/^"/, "").startsWith("'"), value).toBe(true);
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell("Ada")).toBe("Ada");
  });
});
