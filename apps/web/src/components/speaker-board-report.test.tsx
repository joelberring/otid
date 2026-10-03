import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SpeakerBoardResponse, SpeakerBoardRow } from "@o-tid/contracts";
import { SpeakerBoardReport } from "./speaker-board-report";
import { SpeakerBoardAdmin } from "./speaker-board-admin";
const textContent = (html: string) => html.replace(/<[^>]+>/g, "");
const raceId = "10000000-0000-4000-8000-000000000001";
const data: SpeakerBoardResponse = { formatVersion: 1, raceId, eventName: "Syntetisk", raceName: "Lång", raceSnapshotVersion: 7,
  timeZone: "Europe/Stockholm", generatedAt: "2026-09-06T10:00:00.000Z", selection: "LATEST_PUBLISHED_HEADS_BY_REGISTRATION", rows: [] };
const common = { slot: 1, givenName: "Test", familyName: "Löpare", organisationName: null, className: "Öppen", selectedRevision: 4,
  registeredAt: "2026-09-06T09:00:00.000Z" };
describe("speaker presentation", () => {
  it("serverrenders a participant-free login shell", () => {
    const html = renderToStaticMarkup(<SpeakerBoardAdmin raceId={raceId} />);
    expect(html).toContain('type="password"'); expect(html).not.toContain("Test Löpare");
    expect(html).not.toContain("Underlag läst på servern:");
  });
  it("renders empty selection and dated stale warning", () => {
    const html = renderToStaticMarkup(<SpeakerBoardReport data={data} stale />);
    expect(html).toContain("VARNING"); expect(html).toContain("12:00:00"); expect(html).toContain("Europe/Stockholm");
    expect(html).toContain("Inga publicerade resultatunderlag"); expect(html).toContain("Tävlingsversion: 7");
    expect(html).not.toContain("<span>Deltagare</span>");
  });
  it("shows effective NT/DNS/DNF and withdrawn result without any time or invented ranking", () => {
    const rows: SpeakerBoardRow[] = [
      { ...common, state: "ACTIVE_RESULT", result: { revision: 2, status: "NT", reason: "WITHOUT_TIMING" } },
      { ...common, state: "ACTIVE_RESULT", result: { revision: 2, status: "DNS", reason: "DID_NOT_START" } },
      { ...common, state: "ACTIVE_RESULT", result: { revision: 2, status: "DNF", reason: "DID_NOT_FINISH" } },
      { ...common, state: "NO_ACTIVE_RESULT" }
    ];
    for (const row of rows) {
      const html = renderToStaticMarkup(<SpeakerBoardReport data={{ ...data, rows: [row] }} stale={false} />);
      expect(html).toContain("Ingen tid"); expect(html).not.toContain("Placering:");
      expect(textContent(html)).toContain("Vald revision: 4");
      if (row.state === "NO_ACTIVE_RESULT") { expect(html).toContain("Inget aktivt resultat"); expect(html).not.toContain("Effektiv revision:"); }
      else expect(html).toContain("Effektiv revision: 2");
    }
  });
  it("formats only the provided effective time and escapes display text", () => {
    const row: SpeakerBoardRow = { ...common, givenName: "<script>alert(1)</script>", state: "ACTIVE_RESULT",
      result: { revision: 3, status: "OK", reason: "MANUAL_APPROVAL", elapsedMs: 125_000 } };
    const html = renderToStaticMarkup(<SpeakerBoardReport data={{ ...data, rows: [row] }} stale={false} />);
    expect(textContent(html)).toContain("Tid: 2:05"); expect(html).toContain("Effektiv revision: 3"); expect(html).not.toContain("<script>");
  });
});
