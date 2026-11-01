import { describe, expect, it } from "vitest";
import { applyEdit, CourseSettingEditError, emptyDocument, readPpen, writePpen } from "../src";

describe("beskrivningarnas språk", () => {
  it("läses ur <descriptions lang>, ändras med SET_EVENT och skrivs tillbaka med övriga attribut orörda", () => {
    const empty = emptyDocument({ title: "Test", mapScale: 15000 });
    expect(empty.event.descriptionLanguage).toBe("sv");
    const read = readPpen(writePpen(empty)).document;
    expect(read.event.descriptionLanguage).toBe("sv");
    const english = applyEdit(read, { type: "SET_EVENT", changes: { descriptionLanguage: "en" } }).document;
    const xml = writePpen(english);
    expect(xml).toMatch(/<descriptions [^>]*lang="en"/);
    expect(xml).toMatch(/<descriptions [^>]*color="black"/);
    expect(readPpen(xml).document.event.descriptionLanguage).toBe("en");
    expect(() => applyEdit(read, { type: "SET_EVENT", changes: { descriptionLanguage: "svenska" } })).toThrow(CourseSettingEditError);
  });
});
