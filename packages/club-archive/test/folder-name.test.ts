import { describe, expect, it } from "vitest";
import { classifyPath, isCourseDataXml, mapFormatOfHead, xmlRootName } from "../src/classify";
import { normalizePath, parseFolderName, trainingFolderOf } from "../src/folder-name";
import { mapIdentity } from "../src/map-groups";
import { ppenMapReference, referenceFileName } from "../src/ppen-reference";
import { suggestTags } from "../src/tags";

describe("mappnamnen (ADR-0194 beslut 6)", () => {
  it("datum, plats och ledare i hakparenteser", () => {
    expect(parseFolderName("04-02 Skogen [Anna]", 2019)).toEqual({ date: "2019-04-02", place: "Skogen", title: "Skogen", leader: "Anna" });
    expect(parseFolderName("06-04 Ängen - KepsOL [Per & Kim]", 2019))
      .toEqual({ date: "2019-06-04", place: "Ängen", title: "Ängen - KepsOL", leader: "Per & Kim" });
  });

  it("mellanslag i slutet, flera mellanslag och tomma hakparenteser", () => {
    expect(parseFolderName("  05-21   Parken  [Kim]  ", 2019)).toMatchObject({ date: "2019-05-21", place: "Parken", leader: "Kim" });
    expect(parseFolderName("05-21 Parken []", 2019)).toMatchObject({ leader: null, place: "Parken" });
    expect(parseFolderName("05-21 Parken", 2019)).toMatchObject({ leader: null });
  });

  it("udda datum: M-D, MMDD, MM.DD, helt datum, ett datum som inte finns och inget datum", () => {
    expect(parseFolderName("4-2 Skogen", 2019).date).toBe("2019-04-02");
    expect(parseFolderName("0402 Skogen", 2019).date).toBe("2019-04-02");
    expect(parseFolderName("04.02 Skogen", 2019).date).toBe("2019-04-02");
    expect(parseFolderName("2018-08-12 Skogen", 2019).date).toBe("2018-08-12");
    expect(parseFolderName("20180812_Skogen", null).date).toBe("2018-08-12");
    const impossible = parseFolderName("04-31 Skogen", 2019);
    expect(impossible.date).toBeNull();
    expect(impossible.title).toBe("04-31 Skogen");
    expect(parseFolderName("Höstens sprintar [Anna]", 2019)).toMatchObject({ date: null, title: "Höstens sprintar", leader: "Anna" });
    expect(parseFolderName("4-2 Skogen", null).date).toBeNull();
  });

  it("träningens mapp: direkt under årsmappen, undermappar hör till den, filer direkt i årsmappen är egna träningar", () => {
    expect(trainingFolderOf("2019/04-02 Skogen [Anna]/Banor/Skogen.ppen")).toMatchObject({ path: "2019/04-02 Skogen [Anna]", year: 2019,
      date: "2019-04-02", leader: "Anna" });
    expect(trainingFolderOf("2019/06-04 Ängen [Per] /KepsOL.ppen").path).toBe("2019/06-04 Ängen [Per]");
    expect(trainingFolderOf("2019/2019-05-21 Sprint.ppen")).toMatchObject({ path: "2019/2019-05-21 Sprint", date: "2019-05-21" });
    expect(trainingFolderOf("export/2021 Träningar/03-02 Sjön/x.ocd")).toMatchObject({ path: "export/2021 Träningar/03-02 Sjön", year: 2021 });
    // En träningsmapp som börjar med ett helt datum är ingen årsmapp.
    expect(trainingFolderOf("2019-04-02 Skogen/x.ppen")).toMatchObject({ path: "2019-04-02 Skogen", date: "2019-04-02", year: 2019 });
  });

  it("sökvägar normaliseras: \\, NFD från macOS, mellanslag", () => {
    expect(normalizePath("2019\\06-04 A\u0308ngen [Per] \\x.ppen")).toBe("2019/06-04 Ängen [Per]/x.ppen");
  });
});

describe("taggar, filernas slag, .ppen:s karta och kartornas namn", () => {
  it("föreslår taggar ur namnen", () => {
    expect(suggestTags(["2019/06-04 Ängen [Per]", "KepsOL Ängen - Gul.ppen"])).toEqual(["Keps"]);
    expect(suggestTags(["Skogen Rävorientering.ppen"])).toEqual(["Rävorientering"]);
    expect(suggestTags(["Nattsprint stjärna KM"])).toEqual(expect.arrayContaining(["Sprint", "Stjärna", "Natt", "Tävling"]));
    expect(suggestTags(["Kurvbildskorridor"])).toEqual(["Korridor", "Kurvbild"]);
    expect(suggestTags(["Kmärket"])).toEqual([]);
  });

  it("tar bara kartor, .ppen och XML; resten hoppas över utan att läsas", () => {
    expect(classifyPath("a/Karta.OCD")).toEqual({ kind: "MAP", format: "OCD" });
    expect(classifyPath("a/Karta.xmap")).toEqual({ kind: "MAP", format: "OMAP" });
    expect(classifyPath("a/Bana.ppen")).toEqual({ kind: "PPEN" });
    expect(classifyPath("a/Bana.xml")).toEqual({ kind: "XML" });
    for (const [path, category] of [["a/x.pdf", "PDF"], ["a/x.docx", "WORD"], ["a/x.xlsx", "EXCEL"], ["a/x.jpg", "IMAGE"], ["a/x.pgw", "WORLD_FILE"],
      ["a/x.gpx", "GPS"], ["a/x.kmz", "GPS"], ["__MACOSX/a/._x.ocd", "SYSTEM"], ["a/.DS_Store", "SYSTEM"], ["a/Karta.ocd.bak", "BACKUP"],
      ["a/startlista.txt", "OTHER"]] as const) {
      expect(classifyPath(path)).toEqual({ kind: "SKIP", category });
    }
  });

  it("CourseData känns igen på roten; annan XML hoppas över", () => {
    expect(isCourseDataXml("\uFEFF<?xml version=\"1.0\"?>\n<!-- x -->\n<CourseData xmlns=\"http://www.orienteering.org/datastandard/3.0\">")).toBe(true);
    expect(isCourseDataXml("<iof:CourseData>")).toBe(true);
    expect(isCourseDataXml("<?xml version=\"1.0\"?><EntryList>")).toBe(false);
    expect(xmlRootName("<?xml version='1.0'?><!DOCTYPE x><gpx version=\"1.1\">")).toBe("gpx");
  });

  it("kartfilens början avgör formatet", () => {
    const ocd = new Uint8Array(64); ocd[0] = 0xad; ocd[1] = 0x0c;
    expect(mapFormatOfHead(ocd)).toBe("OCD");
    expect(mapFormatOfHead(new TextEncoder().encode("<?xml version=\"1.0\"?>\n<map xmlns=\"http://openorienteering.org/apps/mapper/xml/v2\" version=\"9\">"))).toBe("OMAP");
    expect(mapFormatOfHead(new TextEncoder().encode("OMAP binärt gammalt format"))).toBeNull();
  });

  it(".ppen:s karta: Windows-sökväg, entiteter, ingen karta", () => {
    const xml = `<event id="1"><title>x</title><map kind="OCAD" scale="10000">C:\\Users\\Per\\OL &amp; kartor\\Skogen.ocd</map></event>`;
    expect(ppenMapReference(xml)).toBe("C:\\Users\\Per\\OL & kartor\\Skogen.ocd");
    expect(referenceFileName(ppenMapReference(xml)!)).toBe("Skogen.ocd");
    expect(referenceFileName("/Users/per/OL/A\u0308ngen.omap")).toBe("Ängen.omap");
    expect(ppenMapReference("<event><map kind=\"None\"></map></event>")).toBeNull();
  });

  it("kartornas namn utan datum, version och kopia", () => {
    expect(mapIdentity("Älvsjöskogen 2018-08-12 V11.ocd")).toEqual({ key: "älvsjöskogen", name: "Älvsjöskogen", date: "2018-08-12" });
    expect(mapIdentity("Älvsjöskogen_v12.ocd").key).toBe("älvsjöskogen");
    expect(mapIdentity("Älvsjöskogen - Kopia.ocd").key).toBe("älvsjöskogen");
    expect(mapIdentity("Älvsjöskogen (2).ocd").key).toBe("älvsjöskogen");
    expect(mapIdentity("Älvsjöskogen 2019.ocd").key).toBe("älvsjöskogen");
    expect(mapIdentity("Solberga sprint ver 3.omap")).toMatchObject({ key: "solberga sprint", name: "Solberga sprint" });
    expect(mapIdentity("Vinterviken.xmap").key).toBe("vinterviken");
    expect(mapIdentity("2019.ocd").key).toBe("2019");
  });
});
