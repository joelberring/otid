/** ADR-0196: klubbarkivets kontroll av kartorna, bilderna och kartans rättigheter. */
import type { ClubMapCheckStatus } from "@o-tid/contracts";

export const clubArchiveChecksSv = {
  status: {
    OK: "Fungerar",
    UNSUPPORTED_VERSION: "Versionen stöds inte",
    NOT_A_MAP_FILE: "Inte en kartfil",
    TRUNCATED: "Filen är skadad",
    INVALID: "Filen är skadad",
    EMPTY: "Kartan är tom",
    TOO_LARGE: "För stor för att ritas här",
    FAILED: "Kunde inte ritas"
  } satisfies Record<ClubMapCheckStatus, string>,
  notChecked: "Inte kontrollerad än",
  checking: "Kontrolleras …",
  /** Förklaringen när läsaren inte gav någon egen. */
  explain: {
    OK: "",
    UNSUPPORTED_VERSION: "Kartfilen är från en version som O-Tid inte kan läsa. Öppna den och spara den i nyare OCAD eller i Mapper.",
    NOT_A_MAP_FILE: "Filen är varken en OCAD- eller en Mapper-karta.",
    TRUNCATED: "Filen är avkortad eller trasig. Ladda ner originalet och prova att öppna det i OCAD eller Mapper.",
    INVALID: "Filen är trasig. Ladda ner originalet och prova att öppna det i OCAD eller Mapper.",
    EMPTY: "Kartfilen har inga objekt som O-Tid kan rita.",
    TOO_LARGE: "Kartan blev för stor för att ritas i webbläsaren.",
    FAILED: "Kartan kunde inte ritas i webbläsaren. Ladda ner originalet och öppna det i OCAD eller Mapper."
  } satisfies Record<ClubMapCheckStatus, string>,
  works: (fileVersion: string | null) => fileVersion ? `Fungerar · ${fileVersion}` : "Fungerar",
  mapImage: (name: string) => `Kartan ${name}`,
  noImage: "Ingen bild än",
  trainingImage: (title: string) => `Banan på kartan: ${title}`,
  trainingNoMap: "Ingen karta",
  trainingMapFailed: "Kartan kunde inte ritas",
  previewFailed: (reason: string) => `Kartan kunde inte ritas här: ${reason}`,
  previewDownload: "Ladda ner originalet och öppna det i OCAD eller Mapper.",
  recheckAll: "Kontrollera alla kartor igen",
  recheckHelp: "Läser varje kartversion på nytt, ritar bilderna av kartorna och träningarna och räknar om banfilernas sammanfattningar. Det görs i den här webbläsaren och kan ta en stund.",
  progress: (done: number, total: number, label: string) => `Kontrollerar ${done + 1} av ${total}: ${label}`,
  progressAuto: (done: number, total: number) => `Ritar bilder av kartorna (${done} av ${total}) …`,
  finished: (versions: number, failed: number) => failed === 0
    ? `Klart. ${versions} ${versions === 1 ? "kartversion fungerar" : "kartversioner fungerar"}.`
    : `Klart. ${versions - failed} av ${versions} kartversioner fungerar; se skälen vid versionerna.`,
  stopped: "Kontrollen avbröts. Det som hann bli klart är sparat.",
  summariesFailed: "Banfilernas sammanfattningar kunde inte räknas om.",
  rights: {
    edit: "Ändra rättigheter",
    title: (name: string) => `Kartans rättigheter: ${name}`,
    save: "Spara rättigheterna",
    cancel: "Avbryt",
    saved: "Rättigheterna är sparade.",
    help: "Gäller kartan i alla versioner och följer med när kartan används i en grupp eller en tävling."
  }
} as const;
