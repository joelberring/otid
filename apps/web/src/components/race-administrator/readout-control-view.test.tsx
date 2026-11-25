import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReadoutControlView } from "./readout-control-view";
import type { Workspace } from "./workspace-state";

(globalThis as { React?: typeof React }).React = React;

function fakeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    authenticated: true,
    busy: false,
    classNames: new Map([["c1", "H21"]]),
    data: { id: "r1", timeZone: "Europe/Stockholm", classes: [], entries: [] } as unknown as Workspace["data"],
    disabled: false,
    forestData: {
      raceDate: "2026-11-25",
      timeZone: "Europe/Stockholm",
      generatedAt: "2026-11-25T10:15:00.000Z",
      entries: [
        {
          entryId: "e1", displayName: "Ada Ek", organisationName: "OK Test", className: "H21", classId: "c1",
          cardNumber: "123456", forestState: "IN_FOREST", startState: "STARTED", manualReturnRegistered: false
        }
      ],
      reportedStarts: [],
      radioPunched: []
    } as unknown as Workspace["forestData"],
    forestStale: false,
    functionary: false,
    latestReadouts: { timeZone: "Europe/Stockholm", rows: [] } as unknown as Workspace["latestReadouts"],
    loadRaceDayAttention: vi.fn(),
    openCorrection: vi.fn(),
    operation: { current: undefined },
    pending: { current: undefined },
    profile: { features: { relay: false } } as unknown as Workspace["profile"],
    raceId: "r1",
    sent: { current: false },
    setEntryId: vi.fn(),
    setForestOpen: vi.fn(),
    shows: () => true,
    unknownReadoutAttempt: undefined,
    unknownReadoutCandidate: { readouts: [], classes: [], entries: [] } as unknown as Workspace["unknownReadoutCandidate"],
    unknownReadoutClassId: "",
    unknownReadoutEntryId: "",
    unknownReadoutError: undefined,
    unknownReadoutFamilyName: "",
    unknownReadoutGivenName: "",
    unknownReadoutId: "",
    unknownReadoutOrganisationName: "",
    unknownReadoutTarget: "EXISTING_ENTRY",
    workflowLocked: false,
    ...overrides
  } as Workspace;
}

describe("ReadoutControlView", () => {
  it("öppnar avläsningen i ny flik och visar auto-uppdatering och senaste tidpunkt i sidhuvudet", () => {
    const html = renderToStaticMarkup(<ReadoutControlView ws={fakeWorkspace()} />);
    expect(html).toContain("href=\"/admin/r1/readout\" target=\"_blank\" rel=\"noopener\"");
    expect(html).toContain("data-testid=\"control-auto-refresh\"");
    expect(html).toContain("data-testid=\"control-read-at\"");
    expect(html).toContain("Öppna Ada Ek");
  });

  it("ger funktionärer en direkt knapp för manuell återkomst i Kvar i skogen-kortet", () => {
    const html = renderToStaticMarkup(<ReadoutControlView ws={fakeWorkspace({ functionary: true })} />);
    expect(html).toContain("Manuell återkomst");
    expect(html).toContain("Registrera manuell återkomst för Ada Ek");
    expect(html).not.toContain("Öppna Ada Ek");
  });
});
