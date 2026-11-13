/** Kontots kartlagring (PLAN.md steg L2–L3). */
export const accountStorageSv = {
  title: "Lagring för kartfiler",
  help: "Vad dina kartfiler tar för plats, per kartprojekt. Det som fyller mest står överst.",
  loading: "Räknar …",
  failed: "Lagringen gick inte att hämta.",
  summary: (usedMb: number, limitMb: number | null) => limitMb === null ? `${usedMb} MB används.` : `${usedMb} av ${limitMb} MB används.`,
  nearLimit: "Du är nära gränsen. Ta bort äldre körningar eller underlag du inte behöver.",
  overLimit: "Gränsen är nådd. Nya filer och laserkörningar kan inte sparas förrän du har tagit bort något.",
  empty: "Inga kartfiler ännu.",
  columns: { project: "Kartprojekt", geo: "Laserkörningar", layers: "Underlag", outputs: "Resultat", base: "Grundfil", total: "Totalt", actions: "Åtgärd" },
  other: "Övrigt (klubbarkiv, tävlingar och träningar)",
  mb: (bytes: number) => bytes === 0 ? "–" : bytes < 104858 ? "< 0,1 MB" : `${(bytes / 1048576).toFixed(1).replace(".", ",")} MB`,
  prune: (runs: number) => runs === 1 ? "Ta bort 1 äldre körning" : `Ta bort ${runs} äldre körningar`,
  pruneConfirm: "Körningarnas filer och underlagsbilderna de gav tas bort. Projektets senaste klara körning och dess underlag behålls. Det går inte att ångra.",
  pruneYes: "Ta bort",
  cancel: "Avbryt",
  working: "Tar bort …",
  pruned: (runs: number, layers: number) => `${runs} ${runs === 1 ? "körning" : "körningar"} och ${layers} ${layers === 1 ? "underlagsbild" : "underlagsbilder"} togs bort. Utrymmet frigörs inom ett dygn.`,
  pruneFailed: "Körningarna gick inte att ta bort.",
  open: "Öppna"
};
export type AccountStorageTexts = typeof accountStorageSv;
