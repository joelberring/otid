import { describe, expect, it } from "vitest";
import { matchSeedRanking, parseSeedRanking } from "./seed-ranking-csv";

const entries = [
  { id: "a", name: "Anna Ek", club: "OK Ek", card: "8100001" },
  { id: "b", name: "Bo Berg", club: "IFK Lidingö", card: null },
  { id: "c", name: "Cia Dal", club: "OK Ek", card: null },
  { id: "d", name: "Cia Dal", club: "Tullinge SK", card: null }
];

describe("ranking från fil för seedningen (PLAN.md steg 26)", () => {
  it("läser rubriker på svenska, semikolon och citattecken", () => {
    const parsed = parseSeedRanking("\uFEFFPlacering;Namn;Klubb;Bricka\r\n1;\"Ek; Anna\";OK Ek;8100 001\r\n\r\n2.;Bo Berg;;\n");
    expect(parsed.rows).toEqual([{ line: 2, rank: 1, name: "Ek; Anna", club: "OK Ek", card: "8100001" },
      { line: 4, rank: 2, name: "Bo Berg", club: null, card: null }]);
    expect(parsed.invalid).toEqual([]);
  });

  it("läser filer utan rubriker och med förnamn och efternamn i egna kolumner", () => {
    expect(parseSeedRanking("1,Anna Ek,OK Ek\n2,Bo Berg").rows.map(row => [row.rank, row.name, row.club]))
      .toEqual([[1, "Anna Ek", "OK Ek"], [2, "Bo Berg", null]]);
    expect(parseSeedRanking("Rank\tFörnamn\tEfternamn\n3\tCia\tDal").rows[0]).toMatchObject({ rank: 3, name: "Cia Dal" });
  });

  it("matchar på bricka, sedan namn och klubb, och redovisar rader som inte passar", () => {
    const result = matchSeedRanking("Placering;Namn;Klubb;Bricka\n1;Fel Namn;;8100001\n2;bo  berg;;\n3;Cia Dal;;\n4;Cia Dal;Tullinge SK;\nx;Okänd;;\n5;Ingen Alls;;",
      entries);
    expect([...result.ranks]).toEqual([["a", 1], ["b", 2], ["d", 4]]);
    expect(result.unmatched.map(row => row.line)).toEqual([4, 6, 7]);
  });
});
