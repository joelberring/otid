/** ADR-0219 tillägget om underlagen (K4a): egna underlag i kartprojektets editor. */
export const mapProjectLayersSv = {
  heading: "Underlag",
  help: "Lägg upp ett eget underlag: ortofoto, laserdata, skuggning eller en skannad karta som GeoTIFF, eller PNG/JPEG med världsfil (.pgw, .jgw, .wld). "
    + "En bild utan världsfil läggs mitt på kartan och rättas med passpunkter. Bilden görs klar här i telefonen eller datorn och delas med projektet.",
  none: "Inga underlag ännu.",
  choose: "Välj filer",
  chosen: (names: string) => `Valt: ${names}`,
  name: "Namn",
  crs: "Koordinatsystem (EPSG) om filen inte anger det",
  crsHelp: "T.ex. 3006 för SWEREF 99 TM, 3021 för RT 90, 32633 för UTM 33N, 4326 för WGS 84.",
  upload: "Lägg till",
  preparing: "Bilden görs klar …",
  uploading: "Skickar …",
  show: (name: string) => `Visa ${name}`,
  opacity: (name: string) => `Genomskinlighet för ${name}`,
  remove: "Ta bort",
  up: (name: string) => `Flytta upp ${name}`,
  down: (name: string) => `Flytta ned ${name}`,
  removeConfirm: "Ta bort underlaget för alla i projektet?",
  by: (name: string | null, size: string) => `${name ?? "Okänd"} · ${size}`,
  control: {
    start: "Passpunkter",
    startFor: (name: string) => `Passpunkter för ${name}`,
    heading: (name: string) => `Passpunkter: ${name}`,
    help: "Klicka på en tydlig punkt i bilden (en vägkorsning, ett hörn på ett hus), sedan där den ska ligga på kartan. "
      + "Två punkter flyttar, vrider och skalar bilden; tre eller fler rättar den också snett. Sprid punkterna över bilden.",
    hintImage: "Passpunkter: klicka på en punkt i bilden.",
    hintMap: "Passpunkter: klicka där punkten ska ligga på kartan.",
    none: "Inga punkter ännu.",
    point: (index: number, meters: string) => `Punkt ${index}: ${meters} m`,
    removePoint: (index: number) => `Ta bort punkt ${index}`,
    fit: (kind: "similarity" | "affine", meters: string) => `${kind === "affine" ? "Affin" : "Likformig"}, medelavvikelse ${meters} m`,
    similarity: "Bara flytta, vrida och skala (likformig)",
    undo: "Ångra senaste",
    save: "Spara placeringen",
    saving: "Sparar …",
    cancel: "Avbryt"
  },
  problems: {
    NO_IMAGE: "Välj en bild (GeoTIFF, PNG eller JPEG).",
    NO_GEOREFERENCE: "Bilden saknar georeferens. Välj världsfilen tillsammans med bilden.",
    UNSUPPORTED_CRS: "Koordinatsystemet stöds inte. Ange EPSG-koden (SWEREF 99, RT 90, UTM eller WGS 84).",
    UNREADABLE: "Bilden gick inte att läsa.",
    OUTSIDE: "Bilden täcker inte området.",
    TOO_LARGE: "Bilden är för stor (högst 40 MB efter nedskalning).",
    REJECTED: "Lantmäteriet nekade bilden. Varje produkt beställs för sig på Geotorget; historiska ortofoton är en egen produkt (Ortofoto historiska Nedladdning).",
    UNAVAILABLE: "Bilden gick inte att hämta från Lantmäteriet just nu. Försök igen senare.",
    quota: "Klubbens lagring är full.",
    generic: (status: number) => `Det gick inte (${status}).`
  }
} as const;
