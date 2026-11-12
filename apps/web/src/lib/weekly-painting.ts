import { swedishToday } from "@o-tid/domain";
import type { Language } from "./language";

/**
 * Veckans målning på startsidan (ägarens önskemål 2026-11-12): en målning av Emm Berring, som har godkänt att de visas,
 * byts natten mot måndag svensk tid. Bilden står bredvid rubriken, texten om den i startsidans sidfot.
 *
 * Lägga till en målning: lägg bildfilen i `apps/web/public/malningar/` (liggande format, högst 1000 px på längsta sidan,
 * komprimerad jpg) och skriv en rad i `PAINTINGS` med bildens bredd och höjd i pixlar. Ordningen i listan är visningsordningen.
 */

/** Tekniken som den skrivs i sidfoten, med liten bokstav. */
const TECHNIQUES = {
  oil: { sv: "olja på duk", en: "oil on canvas" },
  acrylicAndOil: { sv: "akryl och olja på duk", en: "acrylic and oil on canvas" }
} as const;

type Painting = {
  readonly file: string; readonly title: string; readonly technique: keyof typeof TECHNIQUES; readonly size: string; readonly year: number;
  readonly width: number; readonly height: number;
};

const PAINTINGS: readonly Painting[] = [
  { file: "skym.jpg", title: "skym", technique: "oil", size: "26 × 35 cm", year: 2022, width: 1000, height: 759 },
  { file: "nav.jpg", title: "nav", technique: "oil", size: "24 × 33 cm", year: 2022, width: 1000, height: 734 },
  { file: "pinn.jpg", title: "pinn", technique: "acrylicAndOil", size: "38 × 46 cm", year: 2024, width: 1000, height: 828 },
  { file: "strandad.jpg", title: "strandad", technique: "oil", size: "50 × 55 cm", year: 2024, width: 1000, height: 909 },
  { file: "insparra.jpg", title: "inspärra", technique: "oil", size: "50 × 65 cm", year: 2025, width: 1000, height: 761 },
  { file: "grums.jpg", title: "grums", technique: "oil", size: "55 × 70 cm", year: 2025, width: 1000, height: 782 },
  { file: "kuling.jpg", title: "kuling", technique: "oil", size: "90 × 120 cm", year: 2025, width: 1000, height: 758 }
];

export type WeeklyPainting = Painting & { readonly src: string };

/** Konstnärens portfolio; bilderna själva serveras av O-Tid och hämtas aldrig därifrån. */
export const ARTIST_PORTFOLIO_URL = "https://berring.se/emm/";

const DAY_MS = 86_400_000;
/** Måndagen i veckan då målningarna kom upp (vecka 46 2026); den veckan visas den första i listan. */
const FIRST_MONDAY = Date.UTC(2026, 10, 9);

/**
 * Löpande veckonummer: hela ISO-veckor (måndag–söndag) sedan `FIRST_MONDAY`, räknat på dagens datum i svensk tid. Det löper
 * vidare över årsskiftet, så ordningen hoppar inte när ISO-veckonumret börjar om på 1 (eller året har 53 veckor).
 */
function weekSerial(now: Date): number {
  const [year, month, day] = swedishToday(now).split("-").map(Number) as [number, number, number];
  return Math.floor((Date.UTC(year, month - 1, day) - FIRST_MONDAY) / (7 * DAY_MS));
}

/** Veckans målning för ett ögonblick (ren funktion, ingen I/O). Samma hela veckan; nästa på måndag 00:00 svensk tid. */
export function paintingOfTheWeek(now: Date): WeeklyPainting {
  const count = PAINTINGS.length;
  const painting = PAINTINGS[((weekSerial(now) % count) + count) % count]!;
  return { ...painting, src: `/malningar/${painting.file}` };
}

/** Tekniken på sidans språk. */
export const paintingTechnique = (painting: WeeklyPainting, language: Language): string => TECHNIQUES[painting.technique][language];
