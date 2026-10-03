import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CheckinVaultSnapshot } from "../lib/checkin-vault";
import { CheckinRosterControls } from "./roster-controls";

const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "10000000-0000-4000-8000-000000000002";
const secondEntryId = "10000000-0000-4000-8000-000000000003";
const deviceId = "10000000-0000-4000-8000-000000000004";
const credentialId = "10000000-0000-4000-8000-000000000005";
const snapshot = (capability: "START_CHECKIN" | "FINISH_FOREST_WATCH", conflict = false): CheckinVaultSnapshot => {
  const action = capability === "START_CHECKIN"
    ? { kind: "MARK_START" as const, state: "STARTED" as const }
    : { kind: "FINISH_CORRECTION" as const, state: "STARTED" as const, manualReturnRegistered: false };
  return {
  vaultId: "10000000-0000-4000-8000-000000000006", version: 9, preparedAt: "2026-09-05T10:00:00.000Z",
  registration: { formatVersion: 1, raceId, actorCredentialId: credentialId, deviceId, label: "Startmobil", capability, registeredAt: "2026-09-05T10:00:00.000Z" },
  roster: { formatVersion: 1, raceId, snapshotVersion: 7, timeZone: "Europe/Stockholm", generatedAt: "2026-09-05T10:00:00.000Z", knowledge: "LAST_SYNCED_ONLY", devices: [], entries: [
    { entryId, entryVersion: 1, classId: raceId, className: "D21", displayName: "Ada Löpare", organisationName: "OK Test", startRule: "FIXED", fixedStartTime: "2026-09-05T10:00:00.000Z", cardNumber: "12345", multipleActiveAssignments: false, revision: 1, startState: "STARTED", manualReturnRegistered: false, readoutReturnRegistered: false, activeDns: false, conflictingReports: true, forestState: "STARTED_NO_RETURN", needsFollowUp: true },
    { entryId: secondEntryId, entryVersion: 1, classId: credentialId, className: "H21", displayName: "Bo Skog", organisationName: null, startRule: "PUNCH", fixedStartTime: null, cardNumber: null, multipleActiveAssignments: false, revision: 0, startState: "UNMARKED", manualReturnRegistered: false, readoutReturnRegistered: false, activeDns: false, conflictingReports: false, forestState: "UNCONFIRMED", needsFollowUp: true }
  ] }, nextSequence: 2, lastReceiptSequence: conflict ? 1 : 0,
  operations: conflict ? [{ operation: { formatVersion: 1, requestId: "10000000-0000-4000-8000-000000000007", dependsOnRequestId: null, deviceId, actorCredentialId: credentialId, raceId, entryId, localSequence: 1, packageVersion: 7, expectedEntryVersion: 1, expectedRevision: 1, observedAt: "2026-09-05T10:00:00.000Z", action }, contentHash: "a".repeat(64), receipt: { formatVersion: 1, storage: "STORED", requestId: "10000000-0000-4000-8000-000000000007", deviceId, raceId, entryId, localSequence: 1, contentHash: "a".repeat(64), receivedAt: "2026-09-05T10:00:00.000Z", effect: { kind: "CONFLICT", revision: 1, reason: "STALE_REVISION" } } }] : []
  };
};

describe("avprickningslistans lokala kontroller", () => {
  it("visar blandad startdata, alla-klasser som standard och aldrig klicktid för fri start", () => {
    const html = renderToStaticMarkup(<CheckinRosterControls snapshot={snapshot("START_CHECKIN")} writing={false} busy={false} onWritingChange={vi.fn()} onMark={vi.fn()} />);
    expect(html).toContain("Alla klasser"); expect(html).toContain("Ada Löpare"); expect(html).toContain("Bo Skog");
    expect(html).toContain("Planerad start: 2026-09-05"); expect(html).toContain("Fri start");
    expect(html).toContain("Serverns startmarkering: Startat"); expect(html).toContain("Lokalt sparad avsikt: Startat");
    expect(html).toContain("Historiska motstridiga uppgifter finns kvar");
  });
  it("håller startkontroller, skrivläge och no-op avstängda", () => {
    const html = renderToStaticMarkup(<CheckinRosterControls snapshot={snapshot("START_CHECKIN")} writing={false} busy={false} onWritingChange={vi.fn()} onMark={vi.fn()} />);
    expect(html).toContain('type="checkbox"'); expect(html).toContain("Aktivera skrivläge");
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("Markera startat"); expect(html).toContain("Markera uppgiven ej start");
  });
  it("skriver bara startrollens filtrerbara privata pappersunderlag utan synkfunktion", () => {
    const start = renderToStaticMarkup(<CheckinRosterControls snapshot={snapshot("START_CHECKIN")} writing={false} busy={false} onWritingChange={vi.fn()} onMark={vi.fn()} />);
    const finish = renderToStaticMarkup(<CheckinRosterControls snapshot={snapshot("FINISH_FOREST_WATCH")} writing={false} busy={false} onWritingChange={vi.fn()} onMark={vi.fn()} />);
    expect(start).toContain("Skriv ut aktuellt startunderlag"); expect(start).toContain("Privat pappersunderlag för start");
    expect(start).toContain("Pappersnotering"); expect(start).toContain("Ingen bricka angiven"); expect(start).toContain("Fri start");
    expect(finish).not.toContain("Skriv ut aktuellt startunderlag"); expect(finish).not.toContain("Privat pappersunderlag för start");
  });
  it("visar målrollens explicita samlade korrektionsformulär", () => {
    const html = renderToStaticMarkup(<CheckinRosterControls snapshot={snapshot("FINISH_FOREST_WATCH")} writing={true} busy={false} onWritingChange={vi.fn()} onMark={vi.fn()} />);
    expect(html).toContain("Spara målkorrektion: Ada Löpare"); expect(html).toContain("Manuell återkomst registrerad");
    expect(html).toContain("Spara målkorrektion"); expect(html).toContain('type="checkbox"');
  });
  it("spärrar kontroller när en lokal konflikt kräver granskning", () => {
    const html = renderToStaticMarkup(<CheckinRosterControls snapshot={snapshot("START_CHECKIN", true)} writing={true} busy={false} onWritingChange={vi.fn()} onMark={vi.fn()} />);
    expect(html).toContain("Konflikter att kontrollera: 1"); expect(html).toContain('disabled=""');
  });
});
