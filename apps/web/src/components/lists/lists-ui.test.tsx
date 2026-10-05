import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StartLists } from "./start-lists";
import { ResultLists } from "./result-lists";
import type { StartListModel } from "../../lib/lists/start-list-model";
import type { ResultListModel } from "../../lib/lists/result-list-model";

const startModel = (cards: boolean): StartListModel => ({ eventName: "Klubbkväll", raceName: "Torsdag", raceDate: "2026-10-08", timeZone: "UTC", cards,
  classes: [{ name: "H21", courseName: "Lång", firstControlCode: 31, mode: { kind: "MINUTE" }, vacancies: ["2026-10-08T10:02:00.000Z"],
    entries: [{ name: "Ada Ek", club: "OK Ek", startTime: "2026-10-08T10:00:00.000Z", variant: "AD",
      ...(cards ? { card: "8001", multipleCards: false } : {}) }] },
  { name: "Öppen", courseName: "Kort", firstControlCode: 45, mode: { kind: "FREE" }, vacancies: [],
    entries: [{ name: "Bo Al", club: null, startTime: null, variant: null }] }] });

describe("startlistorna", () => {
  it("visar verktygsraden, klassrubriken med fakta, vakant tid och variant", () => {
    const html = renderToStaticMarkup(<StartLists model={startModel(true)} />);
    for (const label of ["Per klass", "Per starttid", "Per klubb", "Skriv ut", "Exportera", "IOF XML finns inte för den här listan", "CSV (Excel)"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('aria-pressed="true">Per klass</button>');
    expect(html).toContain("Bana Lång · Minutstart · 1 löpare · 1 vakant tid");
    expect(html).toContain("Vakant");
    expect(html).toContain(">8001<");
    expect(html).toContain(">AD<");
    expect(html).toContain("Bana Kort · Fri start · 1 löpare");
    expect(html).toContain("Startlista per klass");
  });

  it("visar aldrig bricka på den publika listan och länkar IOF-filen", () => {
    const html = renderToStaticMarkup(<StartLists model={startModel(false)} iof={{ href: "/api/races/x/start-list/iof" }} />);
    expect(html).not.toContain("Bricka");
    expect(html).toContain('href="/api/races/x/start-list/iof"');
  });
});

const resultModel: ResultListModel = { relayClasses: [], classes: [{ name: "H21", mixedCourses: false, scored: false, rows: [
  { publicResultId: "00000000-0000-4000-8000-000000000001", name: "Ada Ek", club: "OK Ek", className: "H21", place: 1, timeMs: 600_000,
    behindMs: 0, status: "OK", reason: "MANUAL_APPROVAL", variant: "AD", splits: [], missingControls: [], score: null },
  { publicResultId: null, name: "Bo Al", club: null, className: "H21", place: null, timeMs: 500_000, behindMs: null, status: "MP",
    reason: "MISSING_CONTROL", variant: null, splits: [], missingControls: [33], score: null }] }] };

describe("resultatlistorna", () => {
  it("visar placering, länk till löparens resultat, variant, manuellt godkänd och saknade kontroller", () => {
    const html = renderToStaticMarkup(<ResultLists model={resultModel} raceId="r1" race="Klubbkväll" raceDate="2026-10-08" links />);
    for (const label of ["Per klass", "Med sträcktider", "Per klubb"]) expect(html).toContain(label);
    expect(html).toContain('href="/results/r1/participants/00000000-0000-4000-8000-000000000001"');
    expect(html).toContain("Variant AD");
    expect(html).toContain("Godkänd manuellt av arrangör");
    expect(html).toContain("Felstämplad");
    expect(html).toContain("Saknar 33");
    expect(html).not.toContain("Följ");
    expect(html).not.toContain("rutt");
  });
});
