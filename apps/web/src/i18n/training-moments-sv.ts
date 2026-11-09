import type { TrainingLevel, TrainingMoment } from "@o-tid/contracts";

/** ADR-0222: träningens moment och nivåer (klubbarkivet och terminsplaneringen). */
export const trainingMomentsSv = {
  moments: "Moment",
  momentsHelp: "Välj det träningen övar. Egna ord skriver du under Egna ord.",
  levels: "Nivå",
  levelsHelp: "Svensk Orienterings färger. En träning med flera banor kan ha flera nivåer.",
  tags: "Egna ord",
  tagsHelp: "Skilj med komma, t.ex. Höstlov, Ungdom.",
  suggested: (levels: string) => `Förslag ur banorna: ${levels}`,
  useSuggested: "Använd förslaget",
  filterMoments: "Moment",
  filterMomentsHelp: "Träningar med alla valda moment.",
  filterLevels: "Nivå",
  filterLevelsHelp: "Träningar med någon av de valda nivåerna.",
  momentNames: {
    KARTLASNING: "Kartläsning", LEDSTANG: "Ledstång", KOMPASS: "Kompass", AVSTAND: "Avståndsbedömning", KURVBILD: "Kurvbild",
    VAGVAL: "Vägval", ANGREPPSPUNKT: "Angreppspunkt", DETALJ: "Detaljläsning", FORENKLING: "Förenkling", KONTROLLTAGNING: "Kontrolltagning",
    KARTMINNE: "Kartminne", STRAK: "Stråk", KORRIDOR: "Korridor", FONSTER: "Fönster", NATT: "Natt", SPRINT: "Sprint", GAFFLING: "Gafflingar",
    FYSISK: "Fysisk träning"
  } as Record<TrainingMoment, string>,
  levelNames: { GRON: "Grön", VIT: "Vit", GUL: "Gul", ORANGE: "Orange", VIOLETT: "Violett", BLA: "Blå", SVART: "Svart" } as Record<TrainingLevel, string>
};
