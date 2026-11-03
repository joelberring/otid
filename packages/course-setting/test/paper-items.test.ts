import { describe, expect, it } from "vitest";
import {
  applyEdit, applyPaperTemplate, clipMapPasses, effectivePaper, expandPaperText, keepPaperOnImport, layoutCoursePage, paperClipRing, paperItemSize,
  paperTemplateFromCourse, paperTextForPpen, ppenWithPaperLayout, printSheetGroups, readPpen, scaleBarLength, sheetPaperItems, validatePaperLayout,
  withPaperItem, writePpen, type CourseSettingDocument, type PaperItem, type PaperTemplate
} from "../src";
import { lineCourse } from "./build";

const A4 = { width: 827, height: 1169 };
const SHA = "a".repeat(64);

function course(count = 3) {
  const built = lineCourse(count);
  built.b.edit({ type: "SET_PRINT_AREA", course: built.course, area: { automatic: false, restrictToPageSize: false,
    rect: { minX: -30, minY: -60, maxX: 20 * count + 10, maxY: 60 }, page: { ...A4, margins: 28, landscape: true } } });
  return built;
}
const page = (document: CourseSettingDocument, id: string) => layoutCoursePage(document, { course: id })[0]!;
const title: PaperItem = { id: "t1", kind: "TEXT", at: { corner: "TOP_LEFT", x: 2, y: 3 }, text: "{tävling}\n{bana} {längd}", sizeMm: 4, widthMm: 60, bold: true, background: true };

describe("papperet: element", () => {
  it("variablerna fylls i per bana (okända står kvar, datum och ekvidistans ur dokumentet)", () => {
    const { b, course: id } = course();
    b.edit({ type: "UPDATE_COURSE", course: id, changes: { climbMeters: 42, secondaryTitle: "H21|D21" } });
    b.edit({ type: "SET_EVENT", changes: { title: "KM|natt", paperValues: { date: "9 dec 2026", contourInterval: "2,5 m" } } });
    const frame = { course: id, printScale: 10000 };
    const name = b.document.courses.find(row => row.id === id)!.name;
    expect(expandPaperText("{bana} · {klass} · {stigning} · {skala}", b.document, frame)).toBe(`${name} · H21 D21 · 40 m · 1:10 000`);
    expect(expandPaperText("{tävling} {datum} {ekvidistans} {okänd}", b.document, frame)).toBe("KM natt 9 dec 2026 2,5 m {okänd}");
    // Datumet i utskriften (tävlingens dag) går före dokumentets.
    expect(expandPaperText("{datum}", b.document, frame, "2026-12-09")).toBe("2026-12-09");
    expect(expandPaperText("{längd}", b.document, frame)).toMatch(/^\d+,\d km$/);
    expect(expandPaperText("{variant}\n{bana}", b.document, frame)).toBe(`\n${name}`);
    // Purple Pens makron i .ppen; datum och ekvidistans som text.
    expect(paperTextForPpen("{bana} {längd} {datum}", b.document)).toBe("$(CourseName) $(CourseLength) km 9 dec 2026");
  });

  it("står i ramens hörn på första sidan, med texten radvis och vit bakgrund; tom text står inte", () => {
    const { b, course: id } = course();
    b.edit({ type: "SET_PAPER_LAYOUT", course: id, layout: { items: [title,
      { id: "e", kind: "TEXT", at: { corner: "TOP_LEFT", x: 0, y: 0 }, text: "{variant}", sizeMm: 3, widthMm: 20 },
      { id: "arrow", kind: "NORTH_ARROW", at: { corner: "BOTTOM_RIGHT", x: 5, y: 5 }, sizeMm: 10, relativeTo: "PAGE" }] } });
    const first = page(b.document, id);
    const items = first.paperItems!;
    expect(items.map(item => item.id)).toEqual(["t1", "arrow"]);
    const text = items[0]!;
    expect(text.rect).toMatchObject({ x: first.clip.x + 2, y: first.clip.y + 3, width: 60 });
    // Två rader, 1,2 em radavstånd och 0,8 mm luft runt om.
    expect(text.rect.height).toBeCloseTo(2 * 4 * 1.2 + 1.6, 6);
    expect(text.parts[0]).toMatchObject({ kind: "rect", fill: "WHITE" });
    expect(text.parts.filter(part => part.kind === "text").map(part => part.kind === "text" ? part.text : "")).toEqual([b.document.event.title, expect.stringContaining("km")]);
    // Nordpilen i arkets hörn (inte ramens).
    const arrow = items[1]!;
    expect(arrow.rect.x + arrow.rect.width).toBeCloseTo(first.paper.widthMm - 5, 6);
    expect(arrow.rect.y + arrow.rect.height).toBeCloseTo(first.paper.heightMm - 5, 6);
    expect(arrow.relativeTo).toBe("PAGE");
  });

  it("skalstocken: 1, 2 eller 5 gånger en tiopotens som ryms, i utskriftsskalan", () => {
    expect(scaleBarLength(40, 10000)).toMatchObject({ meters: 200, mm: 20, segments: 4 });
    expect(scaleBarLength(60, 10000)).toMatchObject({ meters: 500, mm: 50, segments: 5 });
    expect(scaleBarLength(40, 4000)).toMatchObject({ meters: 100, mm: 25 });
    const { b, course: id } = course();
    b.edit({ type: "SET_PAPER_LAYOUT", course: id, layout: { items: [{ id: "s", kind: "SCALE_BAR", at: { corner: "BOTTOM_LEFT", x: 0, y: 0 }, widthMm: 60 }] } });
    const bar = page(b.document, id).paperItems![0]!;
    const segments = bar.parts.filter(part => part.kind === "rect");
    expect(segments).toHaveLength(5);
    expect(bar.parts.some(part => part.kind === "text" && part.text === "0")).toBe(true);
    expect(bar.parts.some(part => part.kind === "text" && /\d+ m|km/.test(part.text))).toBe(true);
  });

  it("bilden behåller proportionerna; kontrollen avvisar fel värden", () => {
    const image: PaperItem = { id: "logo", kind: "IMAGE", at: { corner: "TOP_RIGHT", x: 3, y: 3 }, image: SHA, mediaType: "image/png", aspect: 2, widthMm: 30, opacity: 0.5 };
    expect(paperItemSize(image)).toEqual({ width: 30, height: 15 });
    expect(validatePaperLayout({ items: [image] }).items![0]).toEqual(image);
    expect(() => validatePaperLayout({ items: [{ ...image, image: "x" }] })).toThrow(/bilden/);
    expect(() => validatePaperLayout({ items: [{ ...title, sizeMm: 0.2 }] })).toThrow(/storlek/);
    expect(() => validatePaperLayout({ items: [title, title] })).toThrow(/samma id/);
    expect(() => validatePaperLayout({ clip: { shape: "POLYGON", points: [{ x: 0, y: 0 }], outside: "WHITE" } })).toThrow(/polygon/);
    // Okända fält tas bort.
    expect(validatePaperLayout({ items: [{ ...title, extra: 1 } as unknown as PaperItem] }).items![0]).not.toHaveProperty("extra");
  });
});

describe("papperet: mallar", () => {
  it("banan ärver mallen, ändrar och döljer mallens element, och har egna", () => {
    const { b, course: id } = course();
    const template: PaperTemplate = { schemaVersion: 1, id: "km", name: "KM-mall", items: [title,
      { id: "s", kind: "SCALE_BAR", at: { corner: "BOTTOM_RIGHT", x: 2, y: 2 }, widthMm: 40 }],
      clip: { shape: "RECT", rect: { x: 5, y: 5, width: 50, height: 40 }, outside: "FADED" }, descriptions: { columns: 2 } };
    b.edit({ type: "PUT_PAPER_TEMPLATE", template });
    expect(() => applyEdit(b.document, { type: "SET_PAPER_LAYOUT", course: id, layout: { template: "saknas" } })).toThrow(/finns inte/);
    b.edit({ type: "SET_PAPER_LAYOUT", course: id, layout: applyPaperTemplate(b.document, id, template) });
    let effective = effectivePaper(b.document, id);
    expect(effective.items.map(row => [row.item.id, row.source])).toEqual([["t1", "TEMPLATE"], ["s", "TEMPLATE"]]);
    expect(effective.clipSource).toBe("TEMPLATE");
    expect(effective.descriptions.columns).toBe(2);
    // Flytta mallens text för banan, ta bort skalstocken för banan, lägg till en egen nordpil.
    b.edit({ type: "SET_PAPER_LAYOUT", course: id, layout: withPaperItem(b.document, id, "t1", { ...title, at: { corner: "TOP_LEFT", x: 10, y: 10 } }) });
    b.edit({ type: "SET_PAPER_LAYOUT", course: id, layout: withPaperItem(b.document, id, "s", null) });
    b.edit({ type: "SET_PAPER_LAYOUT", course: id, layout: withPaperItem(b.document, id, "n", { id: "n", kind: "NORTH_ARROW", at: { corner: "TOP_RIGHT", x: 1, y: 1 }, sizeMm: 8 }) });
    effective = effectivePaper(b.document, id);
    expect(effective.items.map(row => [row.item.id, row.source])).toEqual([["t1", "OVERRIDE"], ["n", "OWN"]]);
    // Mallen ändras: banans ändring står kvar, resten följer mallen.
    b.edit({ type: "PUT_PAPER_TEMPLATE", template: { ...template, items: [{ ...title, sizeMm: 6 }], descriptions: { columns: 3 } } });
    effective = effectivePaper(b.document, id);
    expect(effective.items.find(row => row.item.id === "t1")!.item).toMatchObject({ sizeMm: 4, at: { x: 10 } });
    expect(effective.descriptions.columns).toBe(3);
    // Klippningen av för banan trots mallens.
    b.edit({ type: "SET_PAPER_LAYOUT", course: id, layout: { ...b.document.event.paperLayouts![id]!, clip: "NONE" } });
    expect(effectivePaper(b.document, id).clip).toBeUndefined();
    // Banans papper som ny mall: det som gäller nu.
    const copy = paperTemplateFromCourse(b.document, id, "copy", "Kopia");
    expect(copy.items.map(item => item.id)).toEqual(["t1", "n"]);
    expect(copy.clip).toBeUndefined();
    // Mallen tas bort: banan står kvar utan mall med sina egna element.
    b.edit({ type: "DELETE_PAPER_TEMPLATE", id: "km" });
    expect(b.document.event.paperTemplates).toBeUndefined();
    expect(effectivePaper(b.document, id).items.map(row => row.item.id)).toEqual(["t1", "n"]);
  });

  it("samma mall på flera banor ger samma element med varje banas variabler", () => {
    const { b, controls } = course();
    const other = b.course("B");
    b.insert(other, controls[0]!);
    const template: PaperTemplate = { schemaVersion: 1, id: "t", name: "Mall", items: [{ ...title, text: "{bana}" }] };
    b.edit({ type: "PUT_PAPER_TEMPLATE", template });
    for (const row of b.document.courses) b.edit({ type: "SET_PAPER_LAYOUT", course: row.id, layout: applyPaperTemplate(b.document, row.id, template) });
    const texts = b.document.courses.map(row => {
      const p = layoutCoursePage(b.document, { course: row.id })[0]!;
      return sheetPaperItems(b.document, { course: row.id, printScale: p.printScale, clip: p.clip }, 0, { page: { x: 0, y: 0, width: 297, height: 210 } })[0]!
        .parts.find(part => part.kind === "text");
    });
    expect(texts.map(part => part?.kind === "text" ? part.text : "")).toEqual(b.document.courses.map(row => row.name));
    expect(other).toBeDefined();
  });
});

describe("papperet: klippningen", () => {
  it("ger kartans pass i kartans mm: innanför som förut, utanför vitt eller tonat; banan klipps inte", () => {
    const { b, course: id } = course();
    b.edit({ type: "SET_PAPER_LAYOUT", course: id, layout: { clip: { shape: "RECT", rect: { x: 10, y: 10, width: 100, height: 80 }, outside: "FADED" } } });
    const [group] = printSheetGroups(b.document, { kind: "COURSE" }, [{ course: id }]);
    const frame = group!.sheets[0]!.frames[0]!;
    const passes = frame.mapPasses!;
    expect(passes).toHaveLength(2);
    expect(passes[0]!.within).toHaveLength(1);
    expect(passes[1]!.without).toHaveLength(1);
    expect(passes[1]!.lighten).toBe(0.75);
    // Ringen är rektangelns hörn i kartans mm (ramens övre vänstra hörn + 10 mm på papperet).
    const ring = paperClipRing({ shape: "RECT", rect: { x: 10, y: 10, width: 100, height: 80 }, outside: "WHITE" }, frame);
    const s = frame.transform.scale;
    expect(ring[0]!.x).toBeCloseTo((frame.clip.x + 10 - frame.transform.translateX) / s, 6);
    expect(ring[0]!.y).toBeCloseTo(-(frame.clip.y + 10 - frame.transform.translateY) / s, 6);
    expect(frame.figures.length).toBeGreaterThan(0);
    // Vitt: bara passet innanför.
    expect(clipMapPasses(undefined, ring, "WHITE")).toEqual([{ within: [[ring]], without: [], filters: [] }]);
    // Utan klippning: inga pass alls (kartan som vanligt).
    b.edit({ type: "SET_PAPER_LAYOUT", course: id, layout: null });
    expect(printSheetGroups(b.document, { kind: "COURSE" }, [{ course: id }])[0]!.sheets[0]!.frames[0]!.mapPasses).toBeUndefined();
  });
});

describe("papperet: .ppen", () => {
  it("texten blir Purple Pens textobjekt och känns igen vid inläsning; beskrivningen på automatisk plats skrivs och förblir automatisk", () => {
    const { b, course: id } = course();
    b.edit({ type: "SET_PAPER_LAYOUT", course: id, layout: { items: [{ ...title, text: "{bana} {datum}" },
      { id: "s", kind: "SCALE_BAR", at: { corner: "BOTTOM_LEFT", x: 0, y: 0 }, widthMm: 40 }] } });
    b.edit({ type: "SET_EVENT", changes: { paperValues: { date: "9 dec" } } });
    const frameOf = (document: CourseSettingDocument) => (course: string) => layoutCoursePage(document, { course })[0];
    const out = ppenWithPaperLayout(b.document, frameOf(b.document));
    const texts = out.specialObjects.filter(special => special.kind === "text");
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ text: "$(CourseName) 9 dec", courses: [id], color: "black" });
    // Automatisk plats: ett descriptions-objekt för banan där O-Tid lägger den.
    const described = out.specialObjects.filter(special => special.kind === "descriptions");
    expect(described).toHaveLength(1);
    expect(described[0]!.courses).toEqual([id]);
    const auto = page(b.document, id).description!;
    expect(auto.source).toBe("AUTO");

    // Tillbaka in: papperet följer med, O-Tid:s text står inte två gånger och beskrivningen är fortfarande automatisk.
    const read = readPpen(writePpen(out)).document;
    const imported = keepPaperOnImport(b.document, read, () => undefined, (document, course) => layoutCoursePage(document, { course })[0]);
    expect(imported.specialObjects.filter(special => special.kind === "text")).toHaveLength(0);
    expect(imported.specialObjects.filter(special => special.kind === "descriptions")).toHaveLength(0);
    expect(imported.event.paperLayouts?.[id]?.items).toHaveLength(2);
    expect(imported.event.paperValues).toEqual({ date: "9 dec" });
    expect(page(imported, id).description!.source).toBe("AUTO");

    // En beskrivning som någon flyttat i Purple Pen blir filens plats.
    const moved = { ...read, specialObjects: read.specialObjects.map(special => special.kind === "descriptions"
      ? { ...special, points: special.points.map(p => ({ x: p.x + 5, y: p.y })) } : special) };
    const kept = keepPaperOnImport(b.document, moved, () => undefined, (document, course) => layoutCoursePage(document, { course })[0]);
    expect(page(kept, id).description!.source).toBe("FILE");
  });

  it("en bild skrivs som bildobjekt när datan finns och känns igen på sin sha256", () => {
    const { b, course: id } = course();
    const image: PaperItem = { id: "logo", kind: "IMAGE", at: { corner: "TOP_RIGHT", x: 3, y: 3 }, image: SHA, mediaType: "image/png", aspect: 1, widthMm: 20 };
    b.edit({ type: "SET_PAPER_LAYOUT", course: id, layout: { items: [image] } });
    const frameOf = (course: string) => layoutCoursePage(b.document, { course })[0];
    expect(ppenWithPaperLayout(b.document, frameOf).specialObjects.some(special => special.kind === "image")).toBe(false);
    const out = ppenWithPaperLayout(b.document, frameOf, { images: new Map([[SHA, "iVBORw0KGgo="]]) });
    const written = out.specialObjects.find(special => special.kind === "image")!;
    expect(written.courses).toEqual([id]);
    const imported = keepPaperOnImport(b.document, out, special => special.id === written.id ? SHA : undefined);
    expect(imported.specialObjects.some(special => special.kind === "image")).toBe(false);
  });
});

describe("papperet steg 3: flera sidor och markeringar vid klippningen (ägaren 2026-11-03)", () => {
  it("en bana på flera sidor: elementen på första sidan, med \"Alla sidor\" på varje sida; beskrivningen bara på första", () => {
    const { b, course: id } = lineCourse(12);
    // Tryckytan bredare än A4: banan delas på flera sidor.
    b.edit({ type: "SET_PRINT_AREA", course: id, area: { automatic: false, restrictToPageSize: false,
      rect: { minX: -30, minY: -60, maxX: 600, maxY: 60 }, page: { ...A4, margins: 28, landscape: false } } });
    b.edit({ type: "SET_PAPER_LAYOUT", course: id, layout: { items: [title,
      { id: "n", kind: "NORTH_ARROW", at: { corner: "TOP_RIGHT", x: 2, y: 2 }, sizeMm: 10, pages: "ALL" }] } });
    const pages = layoutCoursePage(b.document, { course: id });
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]!.paperItems!.map(item => item.id)).toEqual(["t1", "n"]);
    for (const later of pages.slice(1)) {
      expect(later.paperItems!.map(item => item.id)).toEqual(["n"]);
      expect(later.description).toBeUndefined();
    }
    expect(validatePaperLayout({ items: [{ ...title, pages: "ALL" }] }).items![0]!.pages).toBe("ALL");
    expect(() => validatePaperLayout({ items: [{ ...title, pages: "SOME" as never }] })).toThrow(/sidorna/);
  });

  it("banan står hel; markeringar utanför tas bort, delvis innanför klipps; rutan visar alla", () => {
    const { b, course: id } = course(3);
    const inside = b.edit({ type: "ADD_SPECIAL", special: { kind: "water", points: [{ x: -20, y: 40 }] } });
    const outside = b.edit({ type: "ADD_SPECIAL", special: { kind: "first-aid", points: [{ x: 60, y: 40 }] } });
    const area = b.edit({ type: "ADD_SPECIAL", special: { kind: "out-of-bounds", points: [{ x: 0, y: 20 }, { x: 50, y: 20 }, { x: 50, y: 40 }, { x: 0, y: 40 }] } });
    const full = printSheetGroups(b.document, { kind: "COURSE" }, [{ course: id }])[0]!.sheets[0]!.frames[0]!;
    // Klippningen: ramens vänstra halva (kartans x < 20).
    const clip = { shape: "RECT" as const, rect: { x: 0, y: 0, width: full.clip.width / 2, height: full.clip.height }, outside: "WHITE" as const };
    b.edit({ type: "SET_PAPER_LAYOUT", course: id, layout: { clip } });
    const frame = printSheetGroups(b.document, { kind: "COURSE" }, [{ course: id }])[0]!.sheets[0]!.frames[0]!;
    const refs = (frame_: typeof frame, role: string) => frame_.figures.filter(figure => figure.role === role).map(figure => figure.ref);
    // Banans figurer (kontroller, start, mål, sträckor, nummer) är desamma som utan klippning.
    for (const role of ["START", "CONTROL", "FINISH", "LEG", "NUMBER"]) expect(refs(frame, role)).toEqual(refs(full, role));
    // Punktsymbolen utanför tas bort, den innanför står kvar; området ritas klippt.
    const specials = new Set(refs(frame, "SPECIAL"));
    expect(specials.has(outside)).toBe(false);
    expect(specials.has(inside)).toBe(true);
    expect(specials.has(area)).toBe(true);
    expect(frame.markingClip!.refs).toContain(area);
    expect(frame.markingClip!.refs).not.toContain(inside);
    expect(frame.markingClip!.polygon[0]).toEqual({ x: frame.clip.x, y: frame.clip.y });
    // "Visa markeringar utanför utsnittet": allt som förut, ingen klippning av markeringarna.
    b.edit({ type: "SET_PAPER_LAYOUT", course: id, layout: { clip: { ...clip, showMarkings: true } } });
    const shown = printSheetGroups(b.document, { kind: "COURSE" }, [{ course: id }])[0]!.sheets[0]!.frames[0]!;
    expect(shown.markingClip).toBeUndefined();
    expect(new Set(refs(shown, "SPECIAL")).has(outside)).toBe(true);
    expect(validatePaperLayout({ clip: { ...clip, showMarkings: true } }).clip).toMatchObject({ showMarkings: true });
  });
});
