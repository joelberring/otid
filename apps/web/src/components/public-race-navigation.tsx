import Link from "next/link";
import React from "react";
import { sv } from "../i18n/sv";
import { publicRaceSv } from "../i18n/public-race-sv";
import { raceHubPath } from "../lib/public-race-format";
import { publicPagesEn } from "../i18n/public-en";
import type { Language } from "../lib/language";

/** Start- och resultatlistans navigering: tillbaka till tävlingssidan (ADR-0172 beslut 4) och till den andra listan. */
export function PublicRaceNavigation({ raceId, shortCode, currentPage, language = "sv", startList = true }: { raceId: string; shortCode: string;
  currentPage: "results" | "starts"; language?: Language;
  /** Användartest 2026-11-12: resultatsidan länkar till startlistan bara när en publicerad startlista finns. */
  startList?: boolean }) {
  const en = language === "en";
  return <nav className="nav" aria-label={en ? publicPagesEn.navigation : sv.publicRaceNavigation}>
    <Link href={raceHubPath(shortCode)}>{en ? publicPagesEn.back : publicRaceSv.hub.back}</Link>
    {currentPage === "results"
      ? startList && <Link href={`/starts/${raceId}`}>{en ? publicPagesEn.startListLink : sv.publicRaceStartListLink}</Link>
      : <Link href={`/results/${raceId}`}>{en ? publicPagesEn.resultsLink : sv.publicRaceResultsLink}</Link>}
  </nav>;
}
