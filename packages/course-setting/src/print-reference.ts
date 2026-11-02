/**
 * BL-profilerna (ADR-0183 beslut 7): ett tryckeris färgtabell som data, rad för rad som den står i källan, med URL och
 * datum. Porterat ur macpurplepens PrintProfiles.cs (BSD) men med hela tabellen, tabellens ordning och tolkningen av
 * tomma celler. Inga tal är påhittade: varje rad är kontrollerad mot BL:s sida samma dag som `sourceDate`.
 *
 * Versionering: en tabell ändras aldrig. Ändrar BL sina värden blir det en NY tabell (nytt `version`/`sourceDate`) och en
 * ny inbyggd profil med nytt id; tävlingar som godkänt en äldre tabell behåller sin kopia (`PrintProfile.reference`).
 *
 * Tomma celler: en rad där bara K är tom (t.ex. Violett 35/95/0/–) läses med K = 0, som OCAD:s färgruta gör med ett tomt
 * fält och som samma färg står på andra rader (Violett transparent 35/95/0/0); cellen står i `emptyCells` och visas. En
 * rad där alla fyra är tomma (Brun 30 %, Svart 50 % i skogstabellen, "används inte för kartsymboler") har inga värden
 * (`cmyk: null`) och föreslås aldrig som mål.
 */
import type { Cmyk100 } from "./print-profile";

export type CmykChannel = "c" | "m" | "y" | "k";

/** Vad en rad är för banläggningen: banans färg, övre violett, vit skugga, passmärke (förbjudet) eller en kartfärg. */
export type ReferenceRole = "COURSE" | "COURSE_TOP" | "COURSE_WHITE" | "REGISTRATION" | "MAP";

/** Ledtrådar för matchningen: färgord och andel ur namnet räknas ur namnet; här symbolnummer, sorter och ord. */
export interface ReferenceHints {
  /** ISOM 2017-2 / ISSprOM 2019-2 huvudnummer som brukar ha färgen. */
  readonly codes?: readonly number[] | undefined;
  /** Hur färgen brukar användas. */
  readonly kinds?: readonly ("AREA" | "LINE" | "POINT" | "TEXT")[] | undefined;
  /** Ord i kartfärgens namn som pekar på raden (gemener, utan diakritiska krav). */
  readonly words?: readonly string[] | undefined;
}

export interface ReferenceColor {
  /** Stabilt id för raden (används i godkännandet och reglerna). */
  readonly id: string;
  /** Namnet som i källan. */
  readonly name: string;
  /** CMYK i procent; `null` = alla celler tomma i källan. */
  readonly cmyk: Cmyk100 | null;
  /** Celler som är tomma i källan och lästs som 0. */
  readonly emptyCells?: readonly CmykChannel[] | undefined;
  /** Kommentaren i källan. */
  readonly comment?: string | undefined;
  /** Raden i tabellen (1 = överst = ritas sist, som i OCAD:s färgtabell). */
  readonly row: number;
  /** Färgnumret i banläggarstödet när källan anger det (OCAD:s färgnummer). */
  readonly courseNumber?: number | undefined;
  readonly role: ReferenceRole;
  /** Källan säger att raden inte används (längre); föreslås bara vid exakt samma namn. */
  readonly retired?: boolean | undefined;
  readonly hints?: ReferenceHints | undefined;
}

/** En regel eller upplysning ur källan (eller O-Tid:s tolkning av den, `interpretation`). */
export interface ReferenceNote { readonly text: string; readonly url: string; readonly interpretation?: boolean | undefined }

export interface ReferenceTable {
  /** Familjen ("bl-forest", "bl-sprint") och versionen (datumet tabellen kontrollerades). */
  readonly family: string;
  readonly version: string;
  readonly title: string;
  readonly kind: "FOREST" | "SPRINT";
  readonly sourceUrl: string;
  /** Datum då tabellen hämtades och kontrollerades. */
  readonly sourceDate: string;
  /** "Gäller från" enligt källan, när den anger det. */
  readonly effectiveFrom?: string | undefined;
  readonly rows: readonly ReferenceColor[];
  /** Raden för banans violett (kontrollringar, linjer, siffror). */
  readonly courseRow: string;
  /** Uttryckliga ordningsregler ur källan: banans violett ska ligga under respektive över dessa rader. */
  readonly courseBelow: readonly string[];
  readonly courseAbove: readonly string[];
  readonly notes: readonly ReferenceNote[];
}

const FOREST_URL = "https://www.bl-idrottsservice.se/farginstallningar-kartnormen/";
const SPRINT_URL = "https://www.bl-idrottsservice.se/farginstallning-sprintnormen/";
const COURSE_URL = "https://www.bl-idrottsservice.se/baninritning-i-ocad/";
const EXCERPT_URL = "https://www.bl-idrottsservice.se/skapa-kartutsnitt/";
const SEND_URL = "https://www.bl-idrottsservice.se/skicka-kart-och-banfiler/";
const FRAMES_URL = "https://www.bl-idrottsservice.se/ocad-filer-att-ladda-hem/";

type Values = readonly [number | null, number | null, number | null, number | null];

function row(id: string, name: string, values: Values, index: number, extra: Partial<ReferenceColor> = {}): ReferenceColor {
  const channels: CmykChannel[] = ["c", "m", "y", "k"];
  const empty = channels.filter((_, at) => values[at] === null);
  const cmyk = empty.length === 4 ? null : { c: values[0] ?? 0, m: values[1] ?? 0, y: values[2] ?? 0, k: values[3] ?? 0 };
  return { id, name, cmyk, ...(empty.length > 0 && empty.length < 4 ? { emptyCells: empty } : {}), row: index, role: "MAP", ...extra };
}

const ISOM_BLACK = [201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 215, 505, 506, 507, 508, 509, 510, 511, 512, 513, 514, 515, 516, 518, 519,
  521, 524, 525, 526, 529, 530, 531, 532, 533, 601, 602, 603];

/** Delad information om BL:s tryck (baninritning, kartutsnitt, filer); gäller båda tabellerna. */
const BL_COMMON_NOTES: readonly ReferenceNote[] = [
  { text: "BL:s skrivare ger bäst kvalitet vid utskrift från OCAD eller som PDF exporterad från banläggarstödet.", url: COURSE_URL },
  { text: "BL avråder från Purple Pen vid tävlingar (programmet klarar inte kraven på utskrifter); samma försiktighet gäller Condes. O-Tid:s PDF är inte provad hos BL: be om ett provtryck.", url: COURSE_URL },
  { text: "Tabellerna anger bara CMYK och sidorna säger inget om dekorfärger eller övertryck. O-Tid skriver därför kartan och banan som CMYK (processfärger) och banan utan övertryck; att banan inte döljer kartan ordnas med färgordningen.", url: COURSE_URL, interpretation: true },
  { text: "Dolda symboler ska tas bort ur filer till BL. O-Tid ritar aldrig dolda symboler eller oanvända färger, och kartfilen ändras inte.", url: EXCERPT_URL },
  { text: "Största tryckyta är pappersformatet (A4, A3 eller SRA3) minus 5 mm marginal på varje sida. Ramar för OCAD finns att ladda hem.", url: FRAMES_URL },
  { text: "Faktarutan ska säga att kartan är tryckt av BL/StOF; får den inte plats, skriv det som text på kartan.", url: EXCERPT_URL },
  { text: "Skicka minst kartan och banläggningsfilen, kontrollerade, högst 5 MB per e-post.", url: SEND_URL }
];

/** BL skog, kontrollerad 2026-11-02 mot färginställningar kartnormen (27 rader, kolumnen "Färg nr" är tom på sidan). */
export const BL_FOREST_2026_11_02: ReferenceTable = {
  family: "bl-forest", version: "2026-11-02", title: "BL Idrottsservice: färginställningar kartnormen (skog)", kind: "FOREST",
  sourceUrl: FOREST_URL, sourceDate: "2026-11-02",
  courseRow: "violet-transparent",
  courseBelow: ["brown-contours", "black", "blue-line-point"],
  courseAbove: ["blue-70", "blue-50"],
  rows: [
    row("violet-opaque", "Violett", [35, 95, 0, null], 1, { role: "COURSE_TOP", courseNumber: 50, comment: "Används t ex för förbjudet område, Färgnummer i banläggarstödet, 50",
      hints: { codes: [709, 710, 711, 712, 713, 714], words: ["övre", "täckande"] } }),
    row("white", "Vit", [0, 0, 0, 0], 2, { role: "COURSE_WHITE", courseNumber: 55, comment: "Används för vit skugga. Färgnummer i banläggarstödet, 55", hints: { words: ["skugga"] } }),
    row("all-colors", "Alla färger", [100, 100, 100, 100], 3, { role: "REGISTRATION", comment: "Passmärke. Färgen får inte användas i filer till BL",
      hints: { words: ["alla", "pass", "registration", "separation"] } }),
    row("ski-green", "Grön för Skid OL", [76, 0, 91, 0], 4, { hints: { words: ["skid", "ski"], kinds: ["LINE"] } }),
    row("black", "Svart", [0, 0, 0, 100], 5, { hints: { codes: ISOM_BLACK } }),
    row("road-fill", "Vägfyllning", [0, 28, 45, 12], 6, { hints: { codes: [502], words: ["vägfyllning", "fyllning", "väg"], kinds: ["LINE"] } }),
    row("road-edge", "Väg sidlinje", [0, 0, 0, 100], 7, { hints: { codes: [502, 503, 504, 505], words: ["sidlinje", "väg", "kant"], kinds: ["LINE"] } }),
    row("blue-line-point", "Blå linje och punkt", [100, 0, 0, 0], 8, { hints: { codes: [303, 304, 305, 306, 309, 311, 312, 313, 314, 315],
      kinds: ["LINE", "POINT"], words: ["linje", "punkt", "nordlinje"] } }),
    row("water-mask", "Mask för vattendrag", [0, 0, 0, 0], 9, { hints: { words: ["mask", "vattendrag", "blå", "blue"] } }),
    row("brown-contours", "Brun för höjdkurvor mm", [0, 75, 100, 33], 10, { hints: { codes: [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115],
      kinds: ["LINE", "POINT"], words: ["kurv", "höjd", "linje", "punkt"] } }),
    row("violet-transparent", "Violett transparent", [35, 95, 0, 0], 11, { role: "COURSE", courseNumber: 52,
      comment: "Användes kontrollringar, sammanbindningslinjer och kontrollsiffror. Färgnummer i banläggarstödet, 52", hints: { words: ["transparent", "undre", "bana"] } }),
    row("blue-area", "Blå yta", [100, 0, 0, 0], 12, { hints: { codes: [301, 302, 307, 308, 310], kinds: ["AREA"], words: ["yta", "ytobjekt"] } }),
    row("yellow-green", "Gul 100%/grön 50%", [33, 28, 85, 0], 13, { comment: "Tomtmark", hints: { codes: [520, 527], kinds: ["AREA"], words: ["tomt"] } }),
    row("blue-70", "Blå 70%", [70, 0, 0, 0], 14, { comment: "Kan användas till mellanstora sjöar", hints: { codes: [301], kinds: ["AREA"] } }),
    row("blue-50", "Blå 50%", [50, 0, 0, 0], 15, { comment: "Kan användas för stora sjöar", hints: { codes: [301, 302], kinds: ["AREA"] } }),
    row("white-over-green", "Vit över grön", [0, 0, 0, 0], 16, { hints: { words: ["grön", "green"] } }),
    row("green-100", "Grön 100%", [76, 0, 91, 0], 17, { hints: { codes: [407, 409, 410, 411, 413, 417, 418, 419] } }),
    row("green-60", "Grön 60%", [44, 0, 54, 0], 18, { hints: { codes: [408, 409, 415], kinds: ["AREA"] } }),
    row("green-30", "Grön 30%", [20, 0, 26, 0], 19, { hints: { codes: [406, 407], kinds: ["AREA"] } }),
    row("brown-50", "Brun 50%", [0, 28, 45, 12], 20, { hints: { codes: [501, 529], kinds: ["AREA"], words: ["yta", "ytobjekt", "belagd"] } }),
    row("brown-30", "Brun 30%", [null, null, null, null], 21, { comment: "Används inte för kartsymboler" }),
    row("black-50", "Svart 50%", [null, null, null, null], 22, { comment: "Används inte för kartsymboler" }),
    row("black-35", "Svart 35%", [0, 0, 0, 30], 23, { comment: "Berg i dagen", hints: { codes: [214], kinds: ["AREA"], words: ["berg", "grå", "grey", "gray"] } }),
    row("white-over-yellow", "Vit över gul", [0, 0, 0, 0], 24, { comment: "nummer 23 i kartan", hints: { words: ["gul", "yellow"] } }),
    row("yellow-100", "Gul 100%", [0, 27, 94, 0], 25, { hints: { codes: [401, 402, 413], kinds: ["AREA"] } }),
    row("yellow-70", "Gul 70%", [0, 27, 94, 0], 26, { comment: "Används inte längre", retired: true }),
    row("yellow-50", "Gul 50%", [0, 20, 44, 0], 27, { hints: { codes: [403, 404], kinds: ["AREA"] } })
  ],
  notes: [
    { text: "Violetten för kontrollringar och sammanbindningslinjer (Violett transparent) flyttas ner i tabellen så att den hamnar under brunt för höjdkurvor och punkter. Blå 70 % och 50 % ska ligga under denna violetta färg.", url: FOREST_URL },
    { text: "Normalt läggs banpåtryckets färg Violett transparent under bl.a. kurvbild, svartbild och 100 procent blå. Start, mål, vätska och sjukvård kan läggas överst med Övre violett.", url: COURSE_URL },
    { text: "Alla färger (passmärke, 100/100/100/100) får inte användas i filer till BL.", url: FOREST_URL },
    { text: "Ta bort oanvända symboler och sedan oanvända färger (OCAD 11 och senare) innan färgerna ställs in.", url: FOREST_URL },
    { text: "Värdena kan ändras med relativt kort varsel; aktuella värden finns alltid på BL:s webbplats. Sprintkartor har egna inställningar.", url: FOREST_URL },
    { text: "Tomma celler: Violett har tomt K (läst som 0, som Violett transparent 35/95/0/0); Brun 30 % och Svart 50 % är helt tomma och används inte.", url: FOREST_URL, interpretation: true },
    { text: "Tabellens ordning (överst ritas sist) används för vilka färger som ligger över banan: raderna ovanför Violett transparent hamnar över banan, raderna nedanför under (Blå yta ligger alltså under banan).", url: FOREST_URL, interpretation: true },
    ...BL_COMMON_NOTES
  ]
};

/** BL sprint, kontrollerad 2026-11-02 mot färginställning sprintnormen ("gäller från och med 2025-05-01", 30 rader). */
export const BL_SPRINT_2026_11_02: ReferenceTable = {
  family: "bl-sprint", version: "2026-11-02", title: "BL Idrottsservice: färginställning sprintnormen", kind: "SPRINT",
  sourceUrl: SPRINT_URL, sourceDate: "2026-11-02", effectiveFrom: "2025-05-01",
  courseRow: "course-violet",
  // Sprintsidan säger inget om ordningen; tabellens ordning (Svart, Blå och Brun ovanför violetten) är förslaget.
  courseBelow: ["black", "blue", "brown"],
  courseAbove: [],
  rows: [
    row("violet-opaque", "Täckande violett", [35, 100, 0, 0], 1, { role: "COURSE_TOP", hints: { codes: [709, 710, 711, 712, 713, 714], words: ["täckande", "övre"] } }),
    row("white-opaque", "Täckande vitt", [0, 0, 0, 0], 2, { role: "COURSE_WHITE", hints: { words: ["täckande"] } }),
    row("black", "Svart", [0, 0, 0, 100], 3, { hints: { codes: ISOM_BLACK } }),
    row("blue", "Blå", [100, 0, 0, null], 4, { hints: { codes: [303, 304, 305, 306, 309, 311, 312, 313], kinds: ["LINE", "POINT"] } }),
    row("brown", "Brun", [0, 80, 100, 25], 5, { hints: { codes: [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115] } }),
    row("white-two-level", "Vit för två nivåstruktur", [0, 0, 0, 0], 6, { hints: { words: ["nivå", "två"] } }),
    row("course-violet", "Violett (kontrollringar mm)", [35, 100, 0, null], 7, { role: "COURSE",
      comment: "Används även för sammanbindningslinjer och oftast även för kontrollsiffror.", hints: { words: ["kontroll", "ring", "transparent", "undre", "bana"] } }),
    row("white-number-shadow", "Vit skugga för siffra", [0, 0, 0, 0], 8, { role: "COURSE_WHITE", hints: { words: ["skugga", "siffra"] } }),
    row("violet-50", "Violett 50% (53)", [18, 43, 0, 0], 9, { hints: { words: ["53"] } }),
    row("black-50-building", "Svart 50% (byggnad)", [0, 0, 0, 44], 10, { hints: { codes: [521], kinds: ["AREA"], words: ["byggnad", "hus"] } }),
    row("black-20-crossing", "Svart 20% (genomgång)", [0, 0, 0, 15], 11, { hints: { codes: [522], kinds: ["AREA"], words: ["genomgång", "tak"] } }),
    row("green-black", "Grön 100%/Svart 30%", [76, 0, 91, 30], 12, { hints: { codes: [411, 421], kinds: ["AREA"] } }),
    row("green-point", "Grön punkt", [76, 0, 91, null], 13, { hints: { codes: [417, 418, 419], kinds: ["POINT"], words: ["punkt"] } }),
    row("brown-50", "Brun 50% (belagd yta i skog)", [0, 28, 45, 12], 14, { hints: { codes: [501], kinds: ["AREA"], words: ["skog", "belagd"] } }),
    row("brown-30", "Brun 30% (belagd yta i bebyggelse)", [0, 21, 28, 8], 15, { hints: { codes: [501], kinds: ["AREA"], words: ["bebyggelse", "belagd"] } }),
    row("black-contour", "Svart (konturlinje)", [0, 0, 0, 100], 16, { hints: { kinds: ["LINE"], words: ["kontur"] } }),
    row("blue-contour", "Blå kontur", [100, 0, 0, 0], 17, { hints: { kinds: ["LINE"], words: ["kontur"] } }),
    row("blue-70", "Blå 70%", [70, 0, 0, 0], 18, { hints: { codes: [301], kinds: ["AREA"] } }),
    row("blue-30", "Blå 30%", [30, 0, 0, 0], 19, { hints: { codes: [302], kinds: ["AREA"] } }),
    row("blue-area", "Blå (ytor)", [100, 0, 0, 0], 20, { hints: { codes: [301, 302], kinds: ["AREA"], words: ["yta", "ytor", "ytobjekt"] } }),
    row("black-35", "Svart 35% (berg i dagen)", [0, 0, 0, 30], 21, { hints: { codes: [214], kinds: ["AREA"], words: ["berg", "grå", "grey", "gray"] } }),
    row("white-over-green", "Vitt för grön", [0, 0, 0, 0], 22, { hints: { words: ["grön", "green"] } }),
    row("yellow-green", "Gul 100%/Grön 50% (527.1)", [34, 30, 85, 0], 23, { hints: { codes: [520, 527], kinds: ["AREA"], words: ["tomt"] } }),
    row("green-area", "Grön (ytor)", [74, 0, 91, 0], 24, { hints: { codes: [410, 413], kinds: ["AREA"], words: ["yta", "ytor", "ytobjekt"] } }),
    row("green-60", "Grön 60%", [42, 0, 54, 0], 25, { hints: { codes: [408], kinds: ["AREA"] } }),
    row("green-30", "Grön 30%", [21, 0, 26, 0], 26, { hints: { codes: [406], kinds: ["AREA"] } }),
    row("white-over-yellow", "Vit över gul", [0, 0, 0, 0], 27, { hints: { words: ["gul", "yellow"] } }),
    row("yellow", "Gul", [0, 28, 95, 0], 28, { hints: { codes: [401, 402], kinds: ["AREA"] } }),
    row("yellow-50", "Gul 50%", [0, 21, 44, 0], 29, { hints: { codes: [403, 404], kinds: ["AREA"] } }),
    row("brown-lower-30", "Undre brun 30", [0, 21, 28, 8], 30, { hints: { words: ["undre"], kinds: ["AREA"] } })
  ],
  notes: [
    { text: "Den nu aktuella inställningen gäller från och med 2025-05-01. Ställ in färgerna i kartfilen enligt tabellen. Värdena kan ändras med kort varsel.", url: SPRINT_URL },
    { text: "Sprintsidan säger inget om färgordningen. O-Tid föreslår tabellens ordning: Violett (kontrollringar mm) under Svart, Blå och Brun och över resten.", url: SPRINT_URL, interpretation: true },
    { text: "Tomma celler: Blå, Violett (kontrollringar mm) och Grön punkt har tomt K, läst som 0 (som Täckande violett 35/100/0/0, Blå kontur 100/0/0/0).", url: SPRINT_URL, interpretation: true },
    { text: "Passmärkesfärgen (Alla färger, 100/100/100/100) får inte finnas i filer till BL (skogssidan; sprinttabellen har ingen sådan rad).", url: FOREST_URL },
    ...BL_COMMON_NOTES
  ]
};

/** Alla tabeller som O-Tid känner, äldst först per familj. Lägg till nya; ändra aldrig en befintlig. */
export const REFERENCE_TABLES: readonly ReferenceTable[] = [BL_FOREST_2026_11_02, BL_SPRINT_2026_11_02];

export const referenceRow = (table: ReferenceTable, id: string): ReferenceColor | undefined => table.rows.find(item => item.id === id);

/** Sidan av banan som raden ligger på enligt tabellens ordning. */
export function referenceSide(table: ReferenceTable, item: ReferenceColor): "OVER" | "COURSE" | "UNDER" {
  const course = referenceRow(table, table.courseRow);
  if (!course || item.id === course.id) return "COURSE";
  return item.row < course.row ? "OVER" : "UNDER";
}
