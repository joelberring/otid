"use client";

import { useEffect, useState } from "react";
import type { RaceMapAgreementView } from "@o-tid/contracts";
import { trainingGroupSv } from "../../i18n/training-group-sv";
import { groupFailure, groupRequest } from "../../lib/training-group-client";
import { Button, Notice } from "../ui";
import { MapAgreementSummary } from "./map-agreement";

const text = trainingGroupSv.agreement;

/**
 * Steg 68 (ADR-0182 beslut 4): kartans avtal på tävlingens kartsida (Resultat → Karta och vägval). När avtalet har gått ut
 * eller inte tillåter publik visning visas kartbilden, vägvalskartan och GPS-rutterna inte publikt; admin kan medvetet välja
 * att visa dem ändå (spärr med möjlighet att gå vidare). Utan avtal visas inget.
 */
export function RaceMapAgreementNotice({ raceId, version }: { raceId: string; version?: string | undefined }) {
  const [agreement, setAgreement] = useState<RaceMapAgreementView | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let stopped = false;
    void (async () => {
      const result = await groupRequest(`/api/organizer/races/${raceId}/map-agreement`);
      if (!stopped && result.status === 200) setAgreement((result.json as { agreement: RaceMapAgreementView | null }).agreement);
    })();
    return () => { stopped = true; };
  }, [raceId, version]);

  async function acknowledge(value: boolean) {
    setBusy(true); setProblem("");
    try {
      const result = await groupRequest(`/api/organizer/races/${raceId}/map-agreement`, "PUT", { formatVersion: 1, acknowledge: value });
      if (result.status !== 200) { setProblem(groupFailure(result.status)); return; }
      setAgreement((result.json as { agreement: RaceMapAgreementView }).agreement);
    } finally { setBusy(false); }
  }

  if (!agreement) return null;
  return <div data-testid="race-map-agreement">
    <MapAgreementSummary agreement={agreement} issues={agreement.issues} title={`${text.raceTitle}: ${agreement.mapName}`} />
    {agreement.publicUseBlocked && <Notice tone="attention" role="status">{text.blocked}</Notice>}
    {agreement.publicUseBlocked && <Button variant="secondary" disabled={busy} onClick={() => void acknowledge(true)}>{text.acknowledge}</Button>}
    {agreement.acknowledgedAt && <p>{text.acknowledged}{" "}
      <Button variant="quiet" disabled={busy} onClick={() => void acknowledge(false)}>{text.withdraw}</Button></p>}
    {problem && <Notice tone="error" role="alert">{problem}</Notice>}
  </div>;
}
