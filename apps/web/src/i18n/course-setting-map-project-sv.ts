/**
 * Ägarens plan 2026-11-13, etapp 1: banläggningens karta ur ett kartprojekt (välja projektet, den låsta kartversionen och
 * «Ta in kartans ändringar»).
 */
const when = (iso: string) => new Date(iso).toLocaleString("sv-SE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const courseSettingMapProjectSv = {
  picker: {
    heading: "Kartprojekt",
    help: "Välj ett av dina kartprojekt. Banläggningen får kartan som den är nu (grundfilen med införda ändringar) och står kvar på den versionen tills du väljer ”Ta in kartans ändringar”.",
    open: "Välj kartprojekt",
    close: "Stäng listan",
    use: "Använd",
    useProject: (name: string) => `Använd kartprojektet ${name}`,
    changes: (count: number) => count === 0 ? "Inga ändringar än" : count === 1 ? "1 ändrat objekt" : `${count} ändrade objekt`,
    club: (name: string) => `Klubb: ${name}`,
    closed: "Avslutat",
    saved: (name: string) => `Kartan ur kartprojektet ${name} är sparad.`,
    loadFailed: "Kartprojekten kunde inte hämtas."
  },
  working: {
    reading: "Hämtar kartan ur kartprojektet …",
    drawing: "Ritar kartan …",
    saving: "Sparar kartan …"
  },
  errors: {
    refused: "Kartprojektets karta kan inte skrivas som kartfil just nu (till exempel en OCAD-karta med ändringar). Skapa en ny kartversion i kartprojektet och ladda upp den som kartfil i stället.",
    changed: "Kartan ändrades medan den hämtades. Försök igen.",
    forbidden: "Du behöver vara administratör i tävlingen och med i kartprojektet.",
    tooLarge: "Kartan är för stor för att sparas som tävlingens kartfil.",
    quota: "Kvoten för kartor är full.",
    failed: "Kartan kunde inte hämtas ur kartprojektet. Försök igen."
  },
  panel: {
    heading: "Kartan",
    from: (name: string) => `Kartan kommer ur kartprojektet ${name}.`,
    version: (seq: number, iso: string) => `Kartversion ${seq}, hämtad ${when(iso)}. Kartan under banorna ändras inte förrän du tar in kartans ändringar.`,
    newer: (count: number) => count === 1 ? "Kartan har 1 nyare ändring" : `Kartan har ${count} nyare ändringar`,
    upToDate: "Kartan har inga nyare ändringar.",
    update: "Ta in kartans ändringar",
    confirm: "Kartan under banorna byts till kartprojektets aktuella karta. Banorna och kontrollerna ändras inte: kontrollera efteråt att de ligger rätt på den nya kartan. Kartor som redan är tryckta visar den gamla kartan.",
    confirmUpdate: "Ta in ändringarna",
    cancel: "Avbryt",
    openProject: "Öppna kartprojektet",
    notAllowed: "Den som är administratör i tävlingen och med i kartprojektet kan ta in ändringarna.",
    updated: (seq: number) => `Kartans ändringar är intagna (kartversion ${seq}).`,
    toast: (count: number, name: string) => `${count === 1 ? "Kartan har 1 nyare ändring" : `Kartan har ${count} nyare ändringar`} i kartprojektet ${name}. Ta in dem under Inställningar → Kartan.`
  }
} as const;
