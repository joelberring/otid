import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { CheckinHistoryResponse } from "@o-tid/contracts";
import { CheckinHistoryTable } from "./checkin-history-table";

it("visar klockslag i tävlingens tidszon och behåller exakta ögonblick i dateTime (ADR-0169)", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const data: CheckinHistoryResponse = { formatVersion: 1, raceId: id, entryId: id, nextCursor: null, rows: [{
    requestId: id, observedAt: "2026-10-25T00:30:00.123Z", receivedAt: "2026-10-25T01:30:00.456Z",
    source: "MANAGE_RACE", sourceLabel: "Administration", action: { kind: "MARK_START", state: "STARTED" },
    effect: { kind: "UNCHANGED", revision: 1 }
  }] };
  const html = renderToStaticMarkup(<CheckinHistoryTable data={data} timeZone="Europe/Stockholm" />);
  expect(html).toContain(">02:30:00<");
  expect(html).not.toContain("GMT");
  expect(html).not.toContain("Revision");
  expect(html).toContain('dateTime="2026-10-25T00:30:00.123Z"');
  expect(html).toContain('dateTime="2026-10-25T01:30:00.456Z"');
  const utc = renderToStaticMarkup(<CheckinHistoryTable data={data} timeZone="UTC" />);
  expect(utc).toContain(">00:30:00<");
});

it("TASK063 shows review metadata without changing the conflict effect", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const data: CheckinHistoryResponse = { formatVersion: 1, raceId: id, entryId: id, nextCursor: null, rows: [{ requestId: id, observedAt: "2026-09-12T10:00:00.000Z", receivedAt: "2026-09-12T10:01:00.000Z", source: "MANAGE_RACE", sourceLabel: "Administration", action: { kind: "MARK_START", state: "STARTED" }, effect: { kind: "CONFLICT", reason: "STALE_REVISION", revision: 3 }, reviewed: { decision: "KEEP_CURRENT_STATE", reason: "Verifierad", reviewedAt: "2026-09-12T10:02:00.000Z" } }] };
  const html = renderToStaticMarkup(<CheckinHistoryTable data={data} timeZone="UTC" />);
  expect(html).toContain("Granskad: Verifierad"); expect(html).toContain("Granskad: 10:02:00"); expect(data.rows[0]?.effect.kind).toBe("CONFLICT");
});
