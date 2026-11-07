import { describe, expect, it } from "vitest";
import { foldForSearch } from "../src";

describe("foldForSearch", () => {
  it("tar bort accenter och gör gemener", () => {
    expect(foldForSearch("ÅÄÖ åäö é ü")).toBe("aao aao e u");
    expect(foldForSearch("  Åsa Öberg ")).toBe("asa oberg");
  });

  it("viker bokstäver som inte delas upp av Unicode, generöst", () => {
    expect(foldForSearch("Ø ø Æ æ ß ẞ Œ")).toBe("o o ae ae ss ss oe");
    expect(foldForSearch("Søndre Ørsta")).toBe("sondre orsta");
    expect(foldForSearch("Straße")).toBe("strasse");
  });

  it("ger samma text för sammansatta och uppdelade tecken", () => {
    expect(foldForSearch("Ålund".normalize("NFD"))).toBe(foldForSearch("Ålund".normalize("NFC")));
  });
});
