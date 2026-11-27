import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PrintWhat } from "./course-setting-print-what";
import { RunnerControls } from "./course-setting-runner-panel";
import { ALL_RUNNERS } from "../../lib/course-setting-runner-select";

(globalThis as { React?: typeof React }).React = React;

const noop = () => undefined;

describe("PrintWhat och RunnerControls", () => {
  it("visar dubbelsidig baksida under Klasser men inte under Banor eller Provark", () => {
    const base = {
      raceId: "r1", entries: [{ id: "MAIN", name: "Huvudlayout", main: true }], layout: "MAIN", onLayout: noop,
      count: { kind: "OWN" as const, copies: 1 }, onCount: noop, classes: ["H21", "H70"], chosenClasses: ["H21"], onClasses: noop, onBackMode: noop
    };
    const classesNone = renderToStaticMarkup(<PrintWhat {...base} mode="CLASSES" backMode="NONE" />);
    expect(classesNone).toContain('data-testid="print-class-back-mode"');
    expect(classesNone).toContain("Ingen baksida");
    expect(classesNone).toContain("Dubbelsidigt (baksidan direkt efter varje framsida)");
    expect(classesNone).not.toContain("Separat körning");
    expect(classesNone).not.toContain("vänds kring långsidan");

    const classesDuplex = renderToStaticMarkup(<PrintWhat {...base} mode="CLASSES" backMode="DUPLEX" />);
    expect(classesDuplex).toContain("vänds kring långsidan");

    expect(renderToStaticMarkup(<PrintWhat {...base} mode="COURSES" backMode="NONE" />)).not.toContain('data-testid="print-class-back-mode"');
    expect(renderToStaticMarkup(<PrintWhat {...base} mode="PROOF" backMode="NONE" />)).not.toContain('data-testid="print-class-back-mode"');
  });

  it("visar Klassordning (per klass) som tredje val i Ordning under En karta per löpare", () => {
    const html = renderToStaticMarkup(<RunnerControls bundlesState="ready" runners={{ items: [], excluded: [], problems: [], counts: [] }}
      raceId="r1" order="CLASS" setOrder={noop} backMode="NONE" setBackMode={noop} selection={ALL_RUNNERS} setSelection={noop} chosen={0} />);
    expect(html).toContain('data-testid="print-runner-order"');
    expect(html).toContain("Buntordning (per variant)");
    expect(html).toContain("Klassordning (per klass)");
    expect(html).toContain("Startordning");
  });
});
