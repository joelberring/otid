/** PLAN.md steg M7: klubbens lagring på klubbsidan, för ledare, administratörer och ägare. */
const mb = (bytes: number) => bytes === 0 ? "0 MB" : bytes < 104858 ? "< 0,1 MB" : `${(bytes / 1048576).toFixed(1).replace(".", ",")} MB`;

export const clubStorageSv = {
  title: "Klubbens lagring",
  summary: (used: number, limit: number) => `${mb(used)} av ${mb(limit)} används (${Math.min(999, Math.round(used / limit * 100))} %).`,
  help: "Allt i klubbarkivet räknas mot klubben, också den automatiska arkiveringen av klara träningar och det som medlemmar som lämnat klubben laddade upp. En kopia ur arkivet till en egen träning eller ett eget kartprojekt räknas inte en gång till; ändringar i kopian räknas mot det egna kontot. Det som tar mest plats står överst.",
  warning: (used: number, limit: number) => `Klubbens lagring är nästan full: ${mb(used)} av ${mb(limit)}. Ta bort kartversioner ni inte behöver eller be superadmin höja klubbens gräns.`,
  full: (used: number, limit: number) => `Klubbens lagring är full (${mb(used)} av ${mb(limit)}). Inget nytt kan läggas i klubbarkivet förrän något har tagits bort ur arkivet eller superadmin har höjt klubbens gräns.`,
  columns: { map: "Karta", versions: "Versioner", size: "Storlek" },
  courseFiles: "Banfiler",
  empty: "Klubbarkivet har inga kartfiler ännu.",
  mb
};
export type ClubStorageTexts = typeof clubStorageSv;
