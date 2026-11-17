/**
 * Ägaren 2026-11-15 (ADR-0209 tillägg 2026-11-15): arrangörsklubben när tävlingen skapas, och snabblänken från tävlingssidan till
 * adminläget för den som är administratör (uttryckligen eller som ledare i arrangörsklubben för en träning).
 */
export const clubLeadersSv = {
  organiser: {
    legend: "Arrangörsklubb",
    none: "Ingen klubb (eget)",
    notChosen: "Inte vald",
    pickMine: (club: string) => `Välj ${club}`,
    choose: "Välj klubb, eller Ingen klubb för en egen tävling eller träning. Valet styr bland annat om den hamnar i klubbens arkiv.",
    required: "Välj arrangörsklubb, eller Ingen klubb.",
    search: "Sök en annan klubb",
    clear: "Ingen klubb (eget)",
    help: "För en träning blir ledarna i klubbens klubbyta administratörer, så att de når adminläget från tävlingssidan."
  },
  shortcut: {
    label: "Arrangörens genvägar",
    admin: "Till adminläget",
    bingoLeader: "Ledarens tabell"
  }
};
