import { plural } from "./plural";

/** Ägaren 2026-11-12: Hämta ur arkivet i terminsplanens vecka och Kopiera upplägg från termin (ADR-0221 tillägg 2026-11-12). */
export const planCopySv = {
  fromArchive: "Hämta ur arkivet",
  fromArchiveInWeek: (week: number) => `Hämta ur arkivet vecka ${week}`,
  title: (week: number) => `Hämta ur arkivet till vecka ${week}`,
  help: "Välj en träning ur klubbens arkiv. Den blir en planerad träning i veckan; banorna och kartan läggs på med Använd igen.",
  loading: "Läser arkivet …",
  failed: "Arkivet kunde inte läsas.",
  empty: "Arkivet har inga träningar än.",
  search: "Sök",
  searchPlaceholder: "Moment, nivå, karta, plats …",
  count: (shown: number, all: number) => shown === all ? plural(all, "träning", "träningar") : `${shown} av ${all} träningar`,
  none: "Ingen träning passar sökningen.",
  sameWeeks: "Samma veckor tidigare år",
  noDate: "Utan datum",
  courses: (count: number) => plural(count, "bana", "banor"),
  choose: (title: string) => `Välj ${title}`,
  pick: "Välj",
  chosen: "Vald",
  date: "Datum",
  include: "Följer med",
  withMoments: "Moment, nivåer och egna ord",
  withPeople: "Ledarna: den ansvarige och ledarnas uppgifter (övriga uppgifter kopieras utan person)",
  withCourses: "Banorna och kartan: skapa träningen med Använd igen",
  coursesLater: "Banorna och kartan läggs på med Använd igen när träningen ligger fram i tiden.",
  add: "Lägg i veckan",
  adding: "Lägger i veckan …",
  added: "Träningen ur arkivet är planerad.",
  cancel: "Avbryt",
  copyTerm: "Kopiera upplägg från termin",
  copyHelp: "Varje träning i den valda terminen hamnar på samma veckodag i motsvarande vecka. Ledarna följer med; övriga uppgifter kopieras utan person. Ingen träning skapas och inga mejl skickas.",
  copyFrom: "Från terminen",
  copy: "Kopiera",
  copied: (copied: number, outside: number) => `${copied === 1 ? "1 träning kopierad" : `${copied} träningar kopierade`}${outside > 0
    ? `, ${outside} hamnade utanför terminen` : ""}.`
};
