/**
 * Ägaren 2026-11-15 (ADR-0209 tillägg 2026-11-15): arrangörsklubben när tävlingen skapas, och snabblänken från tävlingssidan till
 * adminläget för den som är administratör (uttryckligen eller som ledare i arrangörsklubben för en träning).
 */
export const clubLeadersSv = {
  organiser: {
    legend: "Arrangörsklubb",
    none: "Ingen arrangörsklubb",
    pickMine: (club: string) => `Välj ${club}`,
    choose: "Välj arrangörsklubb, eller ingen.",
    search: "Sök en annan klubb",
    clear: "Ingen",
    help: "För en träning blir ledarna i klubbens klubbyta administratörer, så att de når adminläget från tävlingssidan.",
    saveFailed: "Tävlingen skapades, men arrangörsklubben sparades inte. Välj den under Inställningar → Klubben och klubbarkivet."
  },
  shortcut: {
    label: "Arrangörens genvägar",
    admin: "Till adminläget",
    bingoLeader: "Ledarens tabell"
  }
};
