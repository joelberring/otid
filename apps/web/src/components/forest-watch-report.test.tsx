import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StartCheckinRosterResponse } from "@o-tid/contracts";
import { ForestWatchReport } from "./forest-watch-report";

const raceId = "10000000-0000-4000-8000-000000000001";
const data: StartCheckinRosterResponse = { formatVersion: 1, raceId, snapshotVersion: 7, timeZone: "Europe/Stockholm",
  generatedAt: "2026-09-05T10:00:00.000Z", knowledge: "LAST_SYNCED_ONLY", devices: [], entries: [{
    entryId: "10000000-0000-4000-8000-000000000002", entryVersion: 1, classId: raceId, className: "Öppen", displayName: "Syntetisk Löpare",
    organisationName: null, startRule: "PUNCH", fixedStartTime: null, cardNumber: null, multipleActiveAssignments: false,
    revision: 0, startState: "UNMARKED", manualReturnRegistered: false, readoutReturnRegistered: false, activeDns: false,
    conflictingReports: false, forestState: "UNCONFIRMED", needsFollowUp: true
  }] };
describe("kvar i skogen-rapporten", () => {
  it("TASK062 sorts only started entries, unknown first, retaining ties and default order", () => {
    const names = ["KortTest", "OkändTest", "LångTest", "LikaTest", "KonfliktTest"];
    const entries = names.map((displayName, index) => ({ ...data.entries[0]!, displayName,
      entryId: `10000000-0000-4000-8000-00000000000${index + 1}`, revision: 1,
      startState: "STARTED" as const, forestState: index === 4 ? "CONFLICT" as const : "STARTED_NO_RETURN" as const }));
    const roster = { ...data, entries };
    const reportedStarts = entries.map((entry, index) => ({ entryId: entry.entryId,
      observedAt: index === 1 ? null : index === 2 ? "2026-09-05T09:00:00.000Z" : "2026-09-05T09:40:00.000Z" }));
    const html = renderToStaticMarkup(<ForestWatchReport data={roster} reportedStarts={reportedStarts} classId="" stale sortByAge />);
    const ordered = ["KonfliktTest", "OkändTest", "LångTest", "KortTest", "LikaTest"];
    for (let index = 1; index < ordered.length; index++) expect(html.indexOf(ordered[index - 1]!)).toBeLessThan(html.indexOf(ordered[index]!));
    expect(html).toContain("okänd tid först");
    expect(html).toContain("Underlaget nedan kan vara gammalt");
    const original = renderToStaticMarkup(<ForestWatchReport data={roster} reportedStarts={reportedStarts} classId="" stale={false} />);
    expect(original.indexOf("KortTest")).toBeLessThan(original.indexOf("OkändTest"));
    expect(roster.entries.map(entry => entry.displayName)).toEqual(names);
  });
  it("TASK061 displays age at stale report time and unknown future observations only in admin extension", () => {
    const started: StartCheckinRosterResponse = { ...data, entries: data.entries.map(entry => ({ ...entry,
      revision: 1, startState: "STARTED", forestState: "STARTED_NO_RETURN" })) };
    const html = renderToStaticMarkup(<ForestWatchReport data={started} classId="" stale
      reportedStarts={[{ entryId: started.entries[0]!.entryId, observedAt: "2026-09-05T09:40:00.000Z" }]} />);
    expect(html).toContain("20 min"); expect(html).toContain("ej löptid");
    expect(html).toContain("Underlaget nedan kan vara gammalt");
    const future = renderToStaticMarkup(<ForestWatchReport data={started} classId="" stale={false}
      reportedStarts={[{ entryId: started.entries[0]!.entryId, observedAt: "2026-09-05T11:00:00.000Z" }]} />);
    expect(future).toContain("Okänd tid");
    expect(renderToStaticMarkup(<ForestWatchReport data={started} classId="" stale={false} />)).not.toContain("ej löptid");
  });
  it("visar alla fem grupper och okänd start utan att fabricera DNS", () => {
    const html = renderToStaticMarkup(<ForestWatchReport data={data} classId="" stale={false} />);
    expect(html.match(/data-forest-group=/g)).toHaveLength(5);
    expect(html).toContain("Okänd startstatus – följ upp (1)"); expect(html).toContain("Syntetisk Löpare");
    expect(html).toContain("Fri start / startstämpling"); expect(html).not.toContain("Aktivt ej-startresultat (DNS)");
    expect(html).toContain("garanterar inte att skogen är tom"); expect(html).not.toContain("Tävlingsversion");
    expect(html).toContain("12:00:00"); expect(html).not.toContain("Europe/Stockholm");
  });
  it("behåller filter, täckning och stale-varning i själva rapporten", () => {
    const html = renderToStaticMarkup(<ForestWatchReport data={data} classId="missing" stale />);
    expect(html).not.toContain("Syntetisk Löpare"); expect(html).toContain("0 / 1");
    expect(html).toContain("VARNING: Uppdatering saknas"); expect(html).toContain("Klassfilter: missing");
  });
  it("visar återkomstkällan även i konfliktgruppen", () => {
    const entry = { ...data.entries[0]!, revision: 2, manualReturnRegistered: true, forestState: "CONFLICT" as const, conflictingReports: true };
    const html = renderToStaticMarkup(<ForestWatchReport data={{ ...data, entries: [entry] }} classId="" stale={false} />);
    expect(html).toContain("Återkomst: manuellt registrerad"); expect(html).toContain("Motstridiga uppgifter – kontrollera (1)");
  });
  it("behåller hela loppets gruppantal och enhetsosäkerhet vid noll sökträffar", () => {
    const html = renderToStaticMarkup(<ForestWatchReport data={data} classId="" query="ingen träff" stale />);
    expect(html).not.toContain("Syntetisk Löpare");
    expect(html).toContain('data-forest-group="UNCONFIRMED" data-forest-visible="0" data-forest-total="1"');
    expect(html.match(/data-forest-group=/g)).toHaveLength(5);
    expect(html).toContain("ingen träff");
    expect(html).toContain("garanterar inte att skogen är tom");
    expect(html).toContain("VARNING: Uppdatering saknas");
    expect(html).toContain("osynkade köer är okända");
  });
  it("kombinerar klass och sökning utan att ändra status eller indata", () => {
    const original = structuredClone(data);
    const matching = renderToStaticMarkup(<ForestWatchReport data={data} classId={raceId} query="LÖPARE" stale={false} />);
    expect(matching).toContain("Syntetisk Löpare");
    expect(matching).toContain('data-forest-visible="1" data-forest-total="1"');
    const hidden = renderToStaticMarkup(<ForestWatchReport data={data} classId="annan klass" query="LÖPARE" stale={false} />);
    expect(hidden).not.toContain("Syntetisk Löpare");
    expect(data).toEqual(original);
  });
});
