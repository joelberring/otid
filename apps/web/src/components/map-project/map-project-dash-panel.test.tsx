import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MapObject } from "@o-tid/map-file";
import { mapProjectDashSv } from "../../i18n/map-project-dash-sv";
import { mapProjectKeysSv } from "../../i18n/map-project-keys-sv";
import { mapProjectQuickSv } from "../../i18n/map-project-quick-sv";
import { DEFAULT_KEYS } from "../../lib/map-project-keys";
import { drawDashPreview, drawSelection } from "../../lib/map-project-overlay";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { contextActions, type ContextInput } from "./map-project-context-actions";
import { MapProjectDashPanel } from "./map-project-dash-panel";
import { isDashedObject, isVertexDash, toggleLineVertexDash, type useMapProjectDashPoints } from "./use-map-project-dash-points";

(globalThis as { React?: typeof React }).React = React;

type DashHook = ReturnType<typeof useMapProjectDashPoints>;

function dashMock(patch: Partial<DashHook> = {}): DashHook {
  return {
    canEdit: true,
    text: mapProjectDashSv,
    mode: false,
    setMode: vi.fn(),
    toggleMode: vi.fn(),
    isSelectedDashed: false,
    selectedCount: 0,
    activeVertexDash: false,
    toggleActiveVertex: vi.fn(),
    tapLine: vi.fn(() => false),
    escape: vi.fn(() => false),
    applySelected: vi.fn(),
    scope: "view",
    setScope: vi.fn(),
    bends: true,
    setBends: vi.fn(),
    slopeTags: true,
    setSlopeTags: vi.fn(),
    junctions: true,
    setJunctions: vi.fn(),
    keepExisting: true,
    setKeepExisting: vi.fn(),
    busy: false,
    plan: undefined,
    previewPoints: [],
    status: { kind: "idle" },
    preview: vi.fn(),
    apply: vi.fn(),
    clear: vi.fn(),
    draw: vi.fn(),
    hint: undefined,
    ...patch
  };
}

const renderPanel = (patch?: Partial<DashHook>) => renderToStaticMarkup(<MapProjectDashPanel dash={dashMock(patch)} />);

describe("MapProjectDashPanel", () => {
  it("visar omfattning och alla fyra regelkryssrutor påslagna som förval", () => {
    const html = renderPanel();
    expect(html).toContain("Styrpunkter");
    expect(html).toContain("Markerade linjer");
    expect(html).toContain("Aktuellt utsnitt");
    expect(html).toContain("Hela kartan");
    expect(html).toContain("Skarpa böjar (hjälpkurvor &amp; stigar)");
    expect(html).toContain("Lutningsstreck");
    expect(html).toContain("Stigförgreningar &amp; korsningar");
    expect(html).toContain("Behåll befintliga styrpunkter");
    expect(html).toContain('data-testid="map-project-dash-preview"');
    expect(html).not.toContain('data-testid="map-project-dash-apply"');
  });

  it("visas inte när användaren inte får redigera", () => {
    expect(renderPanel({ canEdit: false })).toBe("");
  });

  it("visar förhandsvisningens uppdelning och knappen Placera styrpunkter", () => {
    const html = renderPanel({
      plan: {
        entries: [],
        counts: { objects: 3, added: 8, bends: 5, slopeTags: 1, junctions: 2 }
      }
    });
    expect(html).toContain("3 objekt, 8 styrpunkter: 5 böjar, 1 lutningsstreck, 2 förgreningar.");
    expect(html).toContain('data-testid="map-project-dash-apply"');
    expect(html).toContain('data-testid="map-project-dash-clear"');
  });

  it("visar problemmeddelande när inga streckade linjer är markerade", () => {
    const html = renderPanel({ scope: "selected", status: { kind: "problem", problem: "noSelection" } });
    expect(html).toContain('data-testid="map-project-dash-problem"');
    expect(html).toContain("Markera minst en streckad linje först.");
  });

  it("visar resultat efter placering och knappen Justera manuellt när en streckad linje är markerad", () => {
    const applied = { kind: "applied" as const, counts: { objects: 1, added: 4, bends: 3, slopeTags: 0, junctions: 1 } };
    const withSelection = renderPanel({ status: applied, isSelectedDashed: true, mode: true });
    expect(withSelection).toContain("4 styrpunkter placerade (3 böjar, 0 lutningsstreck, 1 förgreningar).");
    expect(withSelection).toContain('data-testid="map-project-dash-adjust"');
    expect(withSelection).toContain('aria-pressed="true"');

    const withoutSelection = renderPanel({ status: applied, isSelectedDashed: false });
    expect(withoutSelection).not.toContain('data-testid="map-project-dash-adjust"');
    expect(withoutSelection).toContain("Markera en streckad linje på kartan");
  });
});

describe("styrpunkts-hjälpfunktioner & kontextåtgärder", () => {
  const symbols = new Map<string, CatalogSymbol>([
    ["103", { id: "103", code: "103.0", name: "Hjälpkurva", kind: "line", group: "LANDFORMS", colors: [1], count: 1, dashed: true }],
    ["101", { id: "101", code: "101.0", name: "Nivåkurva", kind: "line", group: "LANDFORMS", colors: [1], count: 1 }]
  ]);

  const dashedLine: MapObject = {
    kind: "line",
    symbol: "103",
    path: [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 5, y: 0, dash: true },
      { type: "L", x: 10, y: 0 }
    ]
  };

  it("identifierar streckade linjer och växlar styrpunkt på vald brytpunkt", () => {
    expect(isDashedObject(dashedLine, symbols)).toBe(true);
    expect(isDashedObject({ ...dashedLine, symbol: "101" }, symbols)).toBe(false);
    expect(isVertexDash(dashedLine, { part: 0, index: 1 })).toBe(true);
    expect(isVertexDash(dashedLine, { part: 0, index: 2 })).toBe(false);

    const toggled = toggleLineVertexDash(dashedLine, { part: 0, index: 1 });
    expect(toggled?.kind).toBe("line");
    expect(isVertexDash(toggled, { part: 0, index: 1 })).toBe(false);
  });

  it("lägger till styrpunkts-åtgärder i kontextraden för streckade linjer", () => {
    const base: ContextInput = { keys: DEFAULT_KEYS, space: "Mellanslag", text: mapProjectKeysSv, quick: mapProjectQuickSv };
    const actions = contextActions({
      ...base,
      single: { kind: "line", switchTo: undefined, canPick: false, shapes: [], canFill: false, vertex: true },
      dash: {
        toggle: { label: "Styrpunkt", pressed: true },
        mode: { label: "Justera styrpunkter", pressed: false },
        auto: { label: "Auto styrpunkter" }
      }
    });
    expect(actions.find(a => a.id === "dashPoint")).toMatchObject({ label: "Styrpunkt", pressed: true, testId: "map-project-dash-vertex" });
    expect(actions.find(a => a.id === "dashMode")).toMatchObject({ label: "Justera styrpunkter", pressed: false, testId: "map-project-dash-mode" });
    expect(actions.find(a => a.id === "autoDash")).toMatchObject({ label: "Auto styrpunkter", testId: "map-project-dash-auto" });
  });

  it("ritar styrpunkter som accentfärgade romber och förhandsvisning som ihåliga romber", () => {
    const fills: string[] = [];
    const strokes: string[] = [];
    const closePath = vi.fn();
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath,
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      bezierCurveTo: vi.fn(),
      arc: vi.fn(),
      rect: vi.fn(),
      setLineDash: vi.fn(),
      lineWidth: 1,
      set fillStyle(v: string) { fills.push(v); },
      get fillStyle() { return fills.at(-1) ?? ""; },
      set strokeStyle(v: string) { strokes.push(v); },
      get strokeStyle() { return strokes.at(-1) ?? ""; },
      fill: vi.fn(),
      stroke: vi.fn()
    } as unknown as CanvasRenderingContext2D;
    const view = { centerX: 5, centerY: 0, pxPerMm: 10, width: 200, height: 200 };

    drawSelection(ctx, view, dashedLine, { part: 0, index: 1 });
    expect(fills).toContain("#0f766e");

    fills.length = 0;
    strokes.length = 0;
    drawDashPreview(ctx, view, [{ x: 2, y: 0 }, { x: 8, y: 0 }]);
    expect(strokes).toContain("#0f766e");
    expect(closePath).toHaveBeenCalled();
  });
});
