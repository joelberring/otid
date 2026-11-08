/** ADR-0219 tillägget om underlagen (K4a): egna underlag i kartprojektets editor. */
export const mapProjectLayersSv = {
  heading: "Underlag",
  help: "Lägg upp ett eget underlag: ortofoto, laserdata, skuggning eller en skannad karta som GeoTIFF, eller PNG/JPEG med världsfil (.pgw, .jgw, .wld). "
    + "Bilden görs klar här i telefonen eller datorn och delas med projektet.",
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
  removeConfirm: "Ta bort underlaget för alla i projektet?",
  by: (name: string | null, size: string) => `${name ?? "Okänd"} · ${size}`,
  problems: {
    NO_IMAGE: "Välj en bild (GeoTIFF, PNG eller JPEG).",
    NO_GEOREFERENCE: "Bilden saknar georeferens. Välj världsfilen tillsammans med bilden.",
    UNSUPPORTED_CRS: "Koordinatsystemet stöds inte. Ange EPSG-koden (SWEREF 99, RT 90, UTM eller WGS 84).",
    UNREADABLE: "Bilden gick inte att läsa.",
    TOO_LARGE: "Bilden är för stor (högst 40 MB efter nedskalning).",
    quota: "Klubbens lagring är full.",
    generic: (status: number) => `Det gick inte (${status}).`
  }
} as const;
