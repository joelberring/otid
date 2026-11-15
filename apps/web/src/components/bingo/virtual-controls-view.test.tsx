import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VirtualControlsView } from "./virtual-controls-view";

// Komponenterna använder JSX utan att importera React (Next); testet ger dem React (vitest kompilerar klassiskt).
(globalThis as { React?: typeof React }).React = React;

describe("virtuella kontroller: banan i telefonen (ADR-0226)", () => {
  it("start som triangel, mål som dubbelring, nummer i ordning och läget med symbol utöver färg; ingen kartbild under loppet", () => {
    const course = { course: "1", name: "Lång", order: "ORDERED" as const, controls: [
      { id: "s", kind: "START" as const, code: "S", x: 0, y: 0, points: 0 }, { id: "a", kind: "CONTROL" as const, code: "31", x: 10, y: 0, points: 10 },
      { id: "b", kind: "CONTROL" as const, code: "32", x: 20, y: 0, points: 10 }, { id: "f", kind: "FINISH" as const, code: "M", x: 20, y: 10, points: 0 }] };
    const html = renderToStaticMarkup(<VirtualControlsView course={course} states={new Map([["a", "MINE"], ["b", "OTHER"]])} dark label="Banan" />);
    expect(html).toContain("<polygon");
    expect(html.match(/<circle/g)).toHaveLength(4);
    expect(html).toContain(">✓<");
    expect(html).toContain("url(#vk-hatch)");
    expect(html).toMatch(/>1<\/text>.*>2<\/text>/);
    expect(html).not.toContain("<image");
  });
});
