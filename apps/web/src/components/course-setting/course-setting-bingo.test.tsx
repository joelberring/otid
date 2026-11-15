import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { applyEdit, type CourseSettingDocument, type CourseSettingEdit } from "@o-tid/course-setting";
import { addBingoGroupEdits } from "../../lib/bingo-setup";
import { testDocument } from "../../lib/course-setting-test-document";
import { BingoBlock } from "./course-setting-bingo";
import { FormIcon } from "./course-setting-training";
import { ShotHeatGrid } from "../bingo/bingo-ships";

// Komponenterna använder JSX utan att importera React (Next); testet ger dem React (vitest kompilerar klassiskt).
(globalThis as { React?: typeof React }).React = React;
const run = (document: CourseSettingDocument, edits: readonly CourseSettingEdit[]) => edits.reduce((doc, edit) => applyEdit(doc, edit).document, document);
const none = () => undefined;

describe("bingo i fliken Träning", () => {
  it("utan område: rita området först; med grupper: namn, rutor, skepp och eget område", () => {
    const empty = renderToStaticMarkup(<BingoBlock document={testDocument()} view="k" readOnly={false} tool={undefined} onTool={none} pendingArea={undefined}
      onEdits={none} onView={none} />);
    expect(empty).toContain("Rita området först");
    expect(empty).toMatch(/<button[^>]*disabled[^>]*data-testid="bingo-add"|data-testid="bingo-add"[^>]*disabled/);
    const document = run(testDocument(), addBingoGroupEdits(testDocument(), "Grön", 100, { minX: 0, minY: 0, maxX: 30, maxY: 20 }, undefined).edits);
    const html = renderToStaticMarkup(<BingoBlock document={document} view="k" readOnly={false} tool={undefined} onTool={none} pendingArea={undefined}
      onEdits={none} onView={none} />);
    expect(html).toContain("Grön");
    expect(html).toContain("6 rutor");
    // Sänka skepp: förvalet för 6 rutor är gemensamt 2 och eget 1.
    expect(html).toMatch(/placeholder="2"[^>]*data-testid="bingo-ships-shared"/);
    expect(html).toMatch(/placeholder="1"[^>]*data-testid="bingo-ships-own"/);
    expect(html).toContain("Eget område");
    // Nästa förslag på namn är nästa färg.
    expect(html).toContain("placeholder=\"Vit\"");
    expect(renderToStaticMarkup(<FormIcon form="BINGO" />)).toContain("A1");
  });

  it("tävlingssidans rutnät: prickar per person upp till fyra, sedan en siffra", () => {
    const html = renderToStaticMarkup(<ShotHeatGrid cellNames={["A1", "B1", "A2"]} counts={{ A1: 3, B1: 7 }} label="Gröna" />);
    expect(html).toContain("•••");
    expect(html).toMatch(/B1<span[^>]*>7</);
    expect(html).not.toMatch(/A2<span/);
  });
});
