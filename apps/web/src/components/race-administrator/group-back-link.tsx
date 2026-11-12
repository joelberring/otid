"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { trainingGroupEn } from "../../i18n/training-group-en";
import { trainingGroupSv } from "../../i18n/training-group-sv";
import { groupRequest } from "../../lib/training-group-client";
import { useTexts } from "../language-provider";

/**
 * Användartestet 2026-11-12 (F): arbetsytan för ett tillfälle i en träningsgrupp har en länk tillbaka till gruppen (bara för
 * gruppens ledare; servern svarar null för andra).
 */
export function GroupBackLink({ raceId }: { raceId: string }) {
  const text = useTexts(trainingGroupSv.leader, trainingGroupEn.leader);
  const [group, setGroup] = useState<{ groupId: string; name: string } | null>(null);
  useEffect(() => {
    let active = true;
    void groupRequest(`/api/organizer/races/${encodeURIComponent(raceId)}/group`).then(result => {
      if (active && result.status === 200) setGroup((result.json as { group: { groupId: string; name: string } | null }).group);
    });
    return () => { active = false; };
  }, [raceId]);
  if (!group) return null;
  return <p data-testid="workspace-group-link"><Link href={`/organizer/groups/${encodeURIComponent(group.groupId)}`}>← {text.backToGroup(group.name)}</Link></p>;
}
