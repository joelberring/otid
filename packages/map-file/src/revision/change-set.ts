/**
 * ADR-0219: kartrevidering, kontraktet mellan revideringsytan och fillagret. Ändringar sparas per objekt mot en bestämd
 * grundfil (dess sha256) och skrivs tillbaka till OCAD (.ocd) eller Mapper (.omap/.xmap) genom att lappa originalets bytes.
 * Originalet skrivs aldrig över: skrivaren ger nya bytes som sparas som en ny kartversion (ADR-0196) bredvid originalet.
 *
 * ## Sammanslagning
 *
 * - En ändring gäller ett objekt (`ObjectRef`) i en grundfil eller lägger till ett nytt objekt.
 * - Två ändringar krockar bara när de gäller samma objekt i samma grundfil (samma `objectKey`). Olika objekt krockar
 *   aldrig, inte heller när de ligger nära varandra eller korsar varandra.
 * - Tillägg (`add`) krockar aldrig. Varje tillägg har ett id som klienten skapar (t.ex. UUID) och som är unikt i satsen.
 * - En ändringssats har högst en ändring per objekt. Samma ritares senare ändring av ett objekt ersätter hans tidigare
 *   (revideringsytan slår ihop dem); ett tillägg som ändras igen är fortfarande ett tillägg med nytt innehåll.
 *   Ändringar från olika ritare av samma objekt är en krock som en person löser innan satsen skrivs; skrivaren vägrar en
 *   sats med två ändringar av samma objekt.
 * - Ändringarna gäller grundfilen med `baseFileSha256`. Har grundfilen bytts ut kan satsen inte skrivas mot den nya filen
 *   (skrivaren vägrar); ändringarna får då föras över för hand eller exporteras för sig.
 *
 * ## Geometri och enheter
 *
 * Geometrin anges i modellens koordinater (kartans mm, y uppåt, som `model.ts`) med modellens punktflaggor (`corner`,
 * `dash`, `gap`) och kurvornas styrpunkter (`C`). Skrivaren räknar om till filens heltal: OCAD 0,01 mm (y uppåt), Mapper
 * 0,001 mm (y nedåt), avrundat till närmaste enhet. En punkt som inte ändrats får tillbaka exakt originalets heltal och
 * alla dess flaggbitar, även bitar som modellen inte visar (t.ex. Mappers luckpunkt eller OCAD:s högre flaggbitar).
 *
 * Det som modellen läser ur filen är det som skrivs: Mapper har inga `dash` eller `gap` i modellen (`dash` skrivs som
 * Mappers streckpunkt och läses tillbaka som `corner`; `gap` skrivs inte). En ytas ringar anges öppna, som läsaren ger dem.
 *
 * Vinklar är grader moturs som i modellen (OCAD 0,1°, Mapper radianer i filen).
 */
import type { MapFileFormat, MapObject, Path, Point } from "../model";

/** Var i en OCAD-fil objektet ligger: indexposten (blocket i kedjan och platsen 0–255) och postens bytes i filen. */
export interface OcdObjectLocator {
  readonly format: "OCD";
  /** Indexblockets nummer i kedjan från filhuvudet, 0 för det första. */
  readonly block: number;
  /** Platsen i blocket, 0–255. */
  readonly slot: number;
  /** Objektpostens position i filen (byte). */
  readonly offset: number;
  /** Objektpostens längd i byte (huvud, koordinater och text; i version 8 räknad ur antalet koordinater). */
  readonly length: number;
}

/**
 * Var i en Mapper-fil (XML) objektet ligger: kartdelen och objektets ordningstal i delens `<objects>` (räknat över alla
 * `<object>`, även sådana som läsaren hoppar över), och `<object …>…</object>` som teckenintervall [start, end) i den
 * avkodade texten (UTF-16-positioner i JavaScript-strängen, efter ett eventuellt BOM).
 */
export interface XmlObjectLocator {
  readonly format: "OMAP";
  readonly part: number;
  readonly ordinal: number;
  readonly start: number;
  readonly end: number;
}

export type ObjectLocator = OcdObjectLocator | XmlObjectLocator;

/**
 * Varifrån ett objekt kom, satt av läsarna i `MapObject.source`. `objectHash` är sha256 (hex, gemener) av objektets
 * originalbytes: OCAD-postens bytes [offset, offset + length) och i Mapper `<object …>…</object>` i UTF-8.
 */
export interface ObjectSource {
  readonly locator: ObjectLocator;
  readonly objectHash: string;
}

/** Ett objekt i en bestämd grundfil: filens sha256 (hex, gemener) och objektets plats och hash. */
export interface ObjectRef extends ObjectSource {
  readonly fileSha256: string;
}

/** Geometri för ett ändrat eller nytt objekt. Typen följer objektet: punkt, linje, yta eller text. */
export type RevisionGeometry =
  | { readonly kind: "point"; readonly at: Point }
  | { readonly kind: "line"; readonly path: Path }
  /** Första ringen är ytterkanten, resten hål. Ringarna är öppna (ingen sista punkt tillbaka till den första). */
  | { readonly kind: "area"; readonly rings: readonly Path[] }
  /** Textens ankarpunkt. I OCAD flyttas textens ruta med ankaret. */
  | { readonly kind: "text"; readonly at: Point };

/** Vem som gjorde ändringen och när. */
export interface ChangeMeta {
  /** Ritarens konto-id (eller annat stabilt id). */
  readonly author: string;
  /** Tidpunkt, ISO 8601. */
  readonly at: string;
}

/**
 * Ändra ett befintligt objekt. Bara de fält som anges ändras; resten (och allt som modellen inte visar, t.ex. OCAD:s
 * objektfärg och Mappers taggar) behålls från originalet. Geometrins typ måste vara objektets.
 */
export interface ModifyChange extends ChangeMeta {
  readonly kind: "modify";
  readonly ref: ObjectRef;
  readonly geometry?: RevisionGeometry | undefined;
  /** Ny symbol (modellens symbol-id). Symbolen måste finnas i filen och passa objektets typ. */
  readonly symbol?: string | undefined;
  /** Ny text (bara textobjekt). */
  readonly text?: string | undefined;
  /** Ny vinkel i grader (punkter och texter; ytor: mönstrets vinkel). */
  readonly angle?: number | undefined;
}

/** Lägg till ett objekt med en befintlig symbol. */
export interface AddChange extends ChangeMeta {
  readonly kind: "add";
  /** Klientens id för tillägget, unikt i satsen. */
  readonly id: string;
  readonly symbol: string;
  readonly geometry: RevisionGeometry;
  readonly text?: string | undefined;
  readonly angle?: number | undefined;
  /** Mapper: kartdelen som objektet läggs i (förval: filens aktuella del). Används inte för OCAD. */
  readonly part?: number | undefined;
}

/** Ta bort ett befintligt objekt. */
export interface DeleteChange extends ChangeMeta {
  readonly kind: "delete";
  readonly ref: ObjectRef;
}

export type MapRevisionChange = ModifyChange | AddChange | DeleteChange;

export interface MapRevisionChangeSet {
  /** sha256 (hex, gemener) av grundfilens bytes. */
  readonly baseFileSha256: string;
  readonly format: MapFileFormat;
  readonly changes: readonly MapRevisionChange[];
}

/** Varför skrivaren vägrar. `change` är ändringens plats i `changes` när skälet gäller en enskild ändring. */
export type MapRevisionRefusalCode =
  /** Filen är inte grundfilen (sha256) eller inte i satsens format. */
  | "BASE_MISMATCH"
  /** Objektet på platsen är inte det som ändringen gäller (objectHash, plats eller fil). */
  | "OBJECT_MISMATCH"
  /** Två ändringar av samma objekt, eller samma tilläggs-id två gånger. */
  | "CONFLICT"
  /** Versionen kan inte skrivas säkert. */
  | "UNSUPPORTED_VERSION"
  /** Filen har något som gör lappningen osäker (packad, okänd teckenkodning, ångrahistorik som pekar på objekt …). */
  | "UNSAFE_FILE"
  /** Ändringen går inte att skriva (okänd symbol, fel geometrityp, tom geometri, koordinater utanför formatet …). */
  | "INVALID_CHANGE"
  /** Kontrollen efter skrivningen hittade en skillnad som inte var tillåten. Filen lämnas inte ut. */
  | "VERIFY_FAILED";

export interface MapRevisionRefusal {
  readonly code: MapRevisionRefusalCode;
  /** Kort förklaring på svenska. */
  readonly message: string;
  readonly change?: number | undefined;
}

/** En ändrad del av filen: [start, end) i originalet ersattes med [newStart, newEnd) i den nya filen (byte). */
export interface ByteEdit {
  readonly start: number;
  readonly end: number;
  readonly newStart: number;
  readonly newEnd: number;
  /** Vad som ändrades, t.ex. "object", "count", "index-entry", "next-block", "append". */
  readonly what: string;
}

export interface MapRevisionReport {
  readonly format: MapFileFormat;
  /** T.ex. "OCAD 2018.8" eller "Mapper v9". */
  readonly version: string;
  readonly baseFileSha256: string;
  /** sha256 av den nya filen. */
  readonly resultSha256: string;
  readonly modified: number;
  readonly added: number;
  readonly deleted: number;
  /** Var de nya objekten hamnade, per tilläggs-id. */
  readonly addedObjects: readonly { readonly id: string; readonly locator: ObjectLocator }[];
  /** Alla ändrade byteintervall, i ordning. Allt annat i originalet finns oförändrat i den nya filen. */
  readonly edits: readonly ByteEdit[];
  /** Kontrollen efter skrivningen (läst igen, objekt för objekt, byte för byte). */
  readonly verification: { readonly untouchedObjects: number; readonly checkedObjects: number; readonly identicalBytes: number };
}

/** Skrivarens svar: den nya filens bytes och en rapport, eller skälen att vägra. Originalet ändras aldrig. */
export type MapRevisionApplyResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly report: MapRevisionReport }
  | { readonly ok: false; readonly refusals: readonly MapRevisionRefusal[] };

/** Nyckeln som avgör krockar: samma nyckel = samma objekt i samma grundfil. */
export function objectKey(ref: ObjectRef): string {
  const locator = ref.locator;
  return locator.format === "OCD"
    ? `${ref.fileSha256}:ocd:${locator.block}:${locator.slot}`
    : `${ref.fileSha256}:omap:${locator.part}:${locator.ordinal}`;
}

/** Ett objekts referens i grundfilen med sha256 `fileSha256`, eller null när läsaren inte satte någon källa. */
export function objectRefOf(fileSha256: string, object: MapObject): ObjectRef | null {
  return object.source ? { fileSha256, locator: object.source.locator, objectHash: object.source.objectHash } : null;
}

/** Ändringar i satsen som krockar (samma objekt två gånger eller samma tilläggs-id), som par av platser i `changes`. */
export function findConflicts(changes: readonly MapRevisionChange[]): readonly (readonly [number, number])[] {
  const seen = new Map<string, number>();
  const conflicts: [number, number][] = [];
  changes.forEach((change, index) => {
    const key = change.kind === "add" ? `add:${change.id}` : objectKey(change.ref);
    const earlier = seen.get(key);
    if (earlier === undefined) seen.set(key, index);
    else conflicts.push([earlier, index]);
  });
  return conflicts;
}
