import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GeoJobList, GeoJobView, MapProjectView } from "@o-tid/contracts";
import { MapProjectGuide } from "./map-project-guide";
import type { useMapProjectImport } from "./use-map-project-import";
import type { useMapProjectLaser } from "./use-map-project-laser";

// Testerna byggs med den klassiska JSX-omvandlingen, som letar efter React globalt (komponenterna importerar det inte).
(globalThis as { React?: typeof React }).React = React;

type Laser = ReturnType<typeof useMapProjectLaser>;
const small = { south: 59.2, west: 18, north: 59.22, east: 18.04 };
const clip = { minX: 670_100, minY: 6_580_100, maxX: 672_400, maxY: 6_582_400 };
const job = (patch: Partial<GeoJobView>) => ({ jobId: "a", name: "Karttapullautin hela kartan", kind: "PULLAUTIN", status: "DONE", tiles: 1, settings: {}, clip, areaId: null,
  progress: null, error: null, outputs: [], own: true, createdAt: "2026-11-13T08:00:00.000Z", finishedAt: null, ...patch }) as GeoJobView;
const view = (canDecide = true) => ({ projectId: "p", viewer: { canPropose: true, canDecide, canManage: canDecide } }) as unknown as MapProjectView;

/** Hooken som den ser ut för guiden, med det som testet behöver. */
function laser(patch: { jobs?: GeoJobView[]; ready?: boolean; credential?: boolean; box?: typeof small; clip?: typeof clip; queue?: GeoJobList["queue"];
  message?: ReturnType<Laser["messageFor"]> } = {}): Laser {
  const ready = patch.ready ?? true;
  const credential = { formatVersion: 1, provider: "LANTMATERIET", available: true,
    saved: ready ? { method: "BASIC", hint: "abcd", updatedAt: "2026-11-17T08:00:00.000Z", readable: true } : null };
  return { credential: patch.credential === false ? undefined : credential, ready, busy: false, active: false,
    list: { formatVersion: 1, jobs: patch.jobs ?? [], server: { state: "READY", detail: null }, queue: patch.queue },
    busyFor: () => undefined, messageFor: () => patch.message, boxOf: () => patch.box ?? small, clipOf: () => patch.clip ?? clip,
    baseMapFiles: (row: GeoJobView) => row.outputs.map(output => output.name), baseMapName: (row: GeoJobView) => `${row.name} – Grundkartan`,
    stagesOf: () => undefined, stagesName: (row: GeoJobView) => `${row.name} – alla etapper – Grundkartan` } as unknown as Laser;
}
const importer = (file?: string) => ({ file: file ? { name: file } : undefined, result: file ? { objects: [1, 2, 3] } : undefined, computing: false }) as unknown as ReturnType<typeof useMapProjectImport>;
const render = (hook: Laser, options: { file?: string; canDecide?: boolean } = {}) => renderToStaticMarkup(<MapProjectGuide view={view(options.canDecide)} laser={hook}
  importer={importer(options.file)} areas={[]} onSplit={options.canDecide === false ? undefined : () => undefined} onAreas={() => undefined}
  onDraw={() => undefined} advanced={<details data-testid="advanced"><summary>Laserkörningar (avancerat)</summary></details>} />);
const outputs = ["kurvor.dxf", "branter.dxf"].map(name => ({ name, mediaType: "", byteSize: 1 }));

describe("guiden Ny grundkarta på sidan", () => {
  it("visar fyra steg med en huvudknapp, och säger att OpenStreetMap hämtas automatiskt", () => {
    const html = render(laser());
    expect(html).toContain('data-step="run"');
    expect(html.match(/data-testid="map-project-guide-step-/g)).toHaveLength(4);
    expect(html).toContain('data-testid="map-project-guide-run"');
    expect(html).toContain('data-testid="map-project-guide-engine"');
    expect(html).toContain("O-Tid (egen motor — snabb, skarvfri, styrbar)");
    expect(html).toContain("Karttapullautin (utan bildmotor — klassiska kurvor)");
    expect(html).toContain("Mycket detaljerad");
    expect(html).toContain("OpenStreetMap (stigar, vägar, hus) och Skogsstyrelsens hyggen behöver du inte hämta själv");
    expect(html).toContain("Ungefär 5,3 km², 1 laserruta");
    // Bara en åtgärd i taget: inga knappar från de andra stegen.
    for (const other of ["split", "load", "cancel", "restart"]) expect(html).not.toContain(`data-testid="map-project-guide-${other}"`);
    // Laserpanelens testid:n dubbleras inte.
    expect(html).not.toContain("map-project-laser");
  });

  it("säger i klartext när området är för stort och erbjuder delning, eller pekar på ägaren", () => {
    const large = laser({ clip: { minX: 670_000, minY: 6_580_000, maxX: 690_000, maxY: 6_600_000 } });
    const html = render(large);
    expect(html).toContain('data-step="area"');
    expect(html).toContain("Hela kartan är för stort för en körning: området täcker 64 laserrutor och en körning tar högst 25.");
    expect(html).toContain('data-testid="map-project-guide-split"');
    expect(html).not.toContain('data-testid="map-project-guide-run"');
    const member = render(large, { canDecide: false });
    expect(member).not.toContain('data-testid="map-project-guide-split"');
    expect(member).toContain("Be en ägare av kartan att dela området");
    // K5: delområdena nås härifrån.
    expect(member).toContain('data-testid="map-project-guide-areas"');
    expect(member).toContain("Till Delområden");
    expect(render(laser({ box: { south: 59, west: 18, north: 59.3, east: 18.1 } }))).toContain("en sökning efter laserdata tar högst 100 km²");
  });

  it("säger lugnt att Lantmäteriet inte är kopplat än, med länkarna, när uppgifterna saknas", () => {
    const html = render(laser({ ready: false }));
    expect(html).toContain('href="/konto#konto-lantmateriet"');
    expect(html).toContain('data-problem="missing"');
    expect(html).toContain("Lantmäteriet är inte kopplat än");
    expect(html).toContain("Så kopplar du Lantmäteriet");
    expect(html).toContain("Lantmäteriet: inte kopplat än.");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('data-testid="map-project-guide-run"');
    // Kopplat: läget står i första delsteget, utan länkar.
    const connected = render(laser());
    expect(connected).toContain('data-link="connected"');
    expect(connected).toContain("Lantmäteriet: kopplat.");
  });

  it("säger att Lantmäteriet sa nej, och att det är fel uppgifter eller en produkt som inte är beställd", () => {
    const html = render(laser({ message: { from: "guide", tone: "error", text: "x", code: "SOURCE_REJECTED" } }));
    expect(html).toContain('data-problem="rejected"');
    expect(html).toContain("Laserdata Nedladdning, skog inte beställd");
    expect(html).toContain("O-Tid kan inte se vilket");
    expect(html).not.toContain('data-testid="map-project-guide-message"');
  });

  it("har laserkörningarna sist i guiden", () => {
    const html = render(laser());
    expect(html).toContain("Välj rutor och inställningar själv");
    expect(html.indexOf('data-testid="advanced"')).toBeGreaterThan(html.indexOf('data-testid="map-project-guide-step-review"'));
  });

  it("visar förlopp, kö, geo-serverns läge och att sidan kan stängas medan körningen pågår", () => {
    const html = render(laser({ jobs: [job({ status: "QUEUED" })], queue: { running: 1, waiting: 2, users: 2, ahead: { a: 1 } } }));
    expect(html).toContain('data-step="wait"');
    expect(html).toContain("Körningen väntar på geo-servern. 1 körning är före din i kön.");
    expect(html).toContain("Geo-servern är igång.");
    expect(html).toContain("1 körning pågår, 2 väntar");
    expect(html).toContain("Du kan stänga sidan eller rita vidare");
    expect(html).toContain("grov gissning");
    const running = render(laser({ jobs: [job({ status: "RUNNING", progress: { step: "Karttapullautin", done: 2, total: 5 } })] }));
    expect(running).toContain("Körningen pågår. Steg i körningen: Karttapullautin (2 av 5).");
  });

  it("erbjuder Läs in grundkartan när körningen är klar, och pekar på utkastet och reglagen när den är inläst", () => {
    const done = laser({ jobs: [job({ outputs })] });
    const html = render(done);
    expect(html).toContain('data-step="review"');
    expect(html).toContain('data-testid="map-project-guide-load"');
    const shown = render(done, { file: "Karttapullautin hela kartan – Grundkartan" });
    expect(shown).not.toContain('data-testid="map-project-guide-load"');
    expect(shown).toContain("Grundkartan visas nu som ett utkast (3 objekt)");
    expect(shown).toContain("3. Gå igenom utkastet");
  });

  it("säger vad man gör härnäst efter ett fel", () => {
    const busy = render(laser({ message: { from: "guide", tone: "error", text: "x", code: "GEO_JOB_BUSY" } }));
    expect(busy).toContain("Vänta tills en är klar, eller avbryt en under Laserkörningar (avancerat) › Jobben");
    const net = render(laser({ message: { from: "guide", tone: "error", text: "Det gick inte (0).", code: undefined } }));
    expect(net).toContain("Det gick inte (0). Försök igen om en stund.");
    expect(render(laser({ jobs: [job({ status: "FAILED", error: "slut på minne" })] }))).toContain("Den förra körningen misslyckades: slut på minne");
  });
});
