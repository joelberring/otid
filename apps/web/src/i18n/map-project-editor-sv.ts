import { plural } from "./plural";
import type { SymbolGroup } from "../lib/map-project-protocol";

/** ADR-0219 (K1): kartprojektets editor (kartan, ritverktygen, lagren och synken). */
export const mapProjectEditorSv = {
  ok: "OK",
  panel: "Symboler och lager",
  openMap: "Öppna kartan",
  openMapHelp: "Kartan med alla ändringar. Med rollen Ändra ritar du direkt i den.",
  back: "Till projektet",
  loading: "Hämtar kartan …",
  failed: "Kartan kunde inte läsas.",
  mapLabel: "Kartprojektets karta",
  readOnly: "Du kan se kartan men inte ändra den.",
  closed: "Projektet är avslutat. Kartan kan inte ändras.",
  tools: {
    label: "Verktyg",
    select: "Redigera",
    selectHelp: "E: markera och flytta objekt och brytpunkter",
    draw: "Rita",
    drawHelp: "P: klicka för hörn, tryck och dra för kurva, dubbelklicka eller Enter för att avsluta",
    undo: "Ångra",
    redo: "Gör om",
    delete: "Ta bort",
    deleteVertex: "Ta bort punkten",
    finish: "Avsluta",
    cancel: "Avbryt",
    switchSymbol: (code: string) => `Byt symbol till ${code}`,
    rotate: "Vrid",
    rotateHelp: "Dra från punkten åt det håll symbolen ska peka.",
    noSymbol: "Välj en symbol att rita med.",
    textNotSupported: "Texter går inte att rita här ännu."
  },
  hints: {
    select: "Klicka på ett objekt för att markera det. Dra det eller dess punkter för att flytta. Dubbelklicka på en rak sträcka för en ny punkt.",
    drawPoint: (code: string) => `Klicka där ${code} ska stå. Dra för att vrida.`,
    drawLine: (code: string) => `Ritar ${code}: klicka för hörn, tryck och dra för kurva. Dubbelklicka eller tryck Enter för att avsluta.`,
    drawArea: (code: string) => `Ritar ytan ${code}: klicka runt den. Dubbelklicka eller tryck Enter för att stänga den.`
  },
  symbols: {
    title: "Symboler",
    search: "Sök symbol",
    searchHelp: "Nummer eller namn, t.ex. 406 eller stig",
    count: (count: number) => plural(count, "objekt", "objekt"),
    none: "Inga symboler matchar.",
    selected: (code: string, name: string) => `Vald: ${code} ${name}`
  },
  layers: {
    title: "Lager",
    help: "Dölj symbolgrupper för att se och markera det som ligger under.",
    groups: {
      LANDFORMS: "Höjder och landformer (1xx)",
      ROCK: "Berg och stenar (2xx)",
      WATER: "Vatten och sankmark (3xx)",
      VEGETATION: "Vegetation (4xx)",
      MANMADE: "Anläggningar (5xx)",
      TECHNICAL: "Tekniska symboler (6xx)",
      COURSE: "Banpåtryck (7xx)",
      OTHER: "Övrigt"
    } satisfies Record<SymbolGroup, string>
  },
  sync: {
    synced: "Sparat",
    syncing: "Sparar …",
    offline: "Utan nät – ändringarna sparas i webbläsaren och skickas när nätet finns",
    error: (status: number) => `Kunde inte spara (${status}). Försöker igen.`,
    pending: (count: number) => plural(count, "ändring väntar", "ändringar väntar"),
    noStore: "Webbläsaren kan inte spara ändringarna lokalt (privat läge?). Stäng inte sidan innan det står Sparat.",
    conflict: "Någon annan ändrade samma objekt. Välj vilket som ska gälla.",
    conflictFirst: "Objektet väntar på ett val efter en krock. Välj först.",
    rejected: "En ändring togs inte emot av servern.",
    changedByOther: "Någon annan har ändrat objektet sedan; steget gick inte att ångra."
  },
  conflicts: {
    title: (count: number) => plural(count, "krock", "krockar"),
    mine: "Behåll min",
    theirs: "Behåll deras",
    object: (code: string) => `Objekt ${code}`
  }
};
