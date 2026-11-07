import type { MapProjectRole } from "@o-tid/contracts";
import { plural } from "./plural";

/** ADR-0219: kartprojekten (steg K0). Ritverktygen kommer i K1; här finns projektet, medlemmarna, filerna och nya versioner. */
export const mapProjectSv = {
  title: "Kartprojekt",
  list: {
    title: "Mina kartprojekt",
    hint: "Kartprojekt där flera ritar på samma karta. Starta ett eget från en kartfil här, eller från en kartversion i klubbarkivets Kartor.",
    empty: "Du är inte med i något kartprojekt än.",
    own: "eget",
    changed: (count: number) => plural(count, "ändrat objekt", "ändrade objekt"),
    closed: "avslutat"
  },
  roles: { OWNER: "Ägare", EDIT: "Ändra", READ: "Läsa" } satisfies Record<MapProjectRole, string>,
  roleHelp: {
    OWNER: "allt: medlemmar, namn, avsluta och nya kartversioner",
    EDIT: "ritar och ändrar kartan",
    READ: "ser kartan och ändringarna"
  } satisfies Record<MapProjectRole, string>,
  upload: {
    title: "Nytt kartprojekt från en kartfil",
    help: "Ett eget projekt, utan klubb. Filen (Mapper eller OCAD) blir grundfilen och ändras aldrig; nya versioner sparas i projektet.",
    name: "Projektets namn",
    file: "Kartfil (.omap, .xmap eller .ocd)",
    button: "Starta projektet",
    tooLarge: "Filen är för stor.",
    unsupported: "Filen är inte en kartfil från Mapper eller OCAD.",
    quota: "Kvoten för kartfiler är full."
  },
  page: {
    kicker: "O-Tid · Kartprojekt",
    ownProject: "Eget projekt (ingen klubb)",
    loading: "Hämtar kartprojektet …",
    base: "Grundversion",
    club: "Klubb",
    changes: "Ändringar",
    changed: (count: number) => plural(count, "ändrat objekt", "ändrade objekt"),
    closed: "Projektet är avslutat. Ingen kan ändra kartan förrän det öppnas igen.",
    drawingSoon: "Att rita och ändra kartan i O-Tid kommer i nästa steg. Här finns projektet, medlemmarna och filerna.",
    ocadLater: "Grundfilen är en OCAD-fil. Att skriva tillbaka till OCAD kommer senare; exportera ändringarna som GeoJSON så länge.",
    download: "Ladda ner grundfilen",
    downloadShort: "Ladda ner",
    exportMapper: "Exportera ändringarna (Mapper)",
    exportGeojson: "Exportera ändringarna (GeoJSON)",
    exportHelp: "En liten egen fil med bara de ändrade och nya objekten, att lägga in i kartan för hand.",
    rename: "Byt namn",
    name: "Projektets namn",
    save: "Spara",
    close: "Avsluta projektet",
    reopen: "Öppna igen",
    closeConfirm: "Avsluta projektet? Ingen kan ändra kartan förrän det öppnas igen.",
    saved: "Sparat.",
    outputs: "Versioner ur projektet",
    noOutputs: "Ingen ny kartversion har skapats ur projektet än.",
    outputLine: (fileName: string, changes: number, date: string) => `${fileName} · ${plural(changes, "ändring", "ändringar")} · ${date}`,
    inArchive: "i klubbarkivet",
    downloadOutput: (fileName: string) => `Ladda ner ${fileName}`
  },
  version: {
    title: "Ny kartversion",
    help: "Skriver ändringarna in i en kopia av grundfilen. Bara de ändrade objekten skrivs om, och filen kontrolleras efteråt. Grundfilen ändras aldrig; den nya versionen sparas i projektet.",
    archive: "Lägg också den nya versionen i klubbarkivet",
    archiveHelp: "Som en ny version av samma karta, bredvid grundversionen.",
    button: "Skapa ny kartversion",
    confirm: "Skapa en ny kartversion med projektets ändringar?",
    confirmArchive: "Skapa en ny kartversion med projektets ändringar och lägga den i klubbarkivet?",
    created: (fileName: string) => `Ny kartversion: ${fileName}.`,
    createdArchive: (fileName: string) => `Ny kartversion i projektet och i klubbarkivet: ${fileName}.`,
    same: (fileName: string) => `Inget har ändrats sedan förra versionen (${fileName}).`,
    empty: "Det finns inga ändringar att skriva.",
    refused: "Ändringarna kunde inte skrivas in i kartfilen. Exportera dem i stället:",
    conflict: "Någon ändrade kartan medan filen skrevs. Försök igen.",
    notOwner: "Bara projektets ägare skapar nya kartversioner."
  },
  members: {
    title: "Medlemmar",
    help: "Bjud in med e-postadress. Inbjudan gäller när personen loggar in med adressen.",
    readerHelp: "Ägarna bjuder in och tar bort medlemmar.",
    you: "du",
    pending: "väntar på inloggning",
    email: "E-postadress",
    role: "Roll",
    invite: "Bjud in",
    inviteButton: "Bjud in",
    invited: "Inbjudan sparad.",
    exists: "Adressen är redan med eller inbjuden.",
    remove: "Ta bort",
    leave: "Lämna projektet",
    removeConfirm: (who: string) => `Ta bort ${who} från projektet? Ändringarna personen gjort står kvar.`,
    leaveConfirm: "Lämna projektet? Dina ändringar står kvar.",
    changeRole: "Byt roll",
    lastOwner: "Projektet måste ha minst en ägare.",
    edits: (count: number) => plural(count, "ändring", "ändringar"),
    clubAdmins: "Klubbens administratörer och ägare har alltid samma rätt som projektets ägare.",
    lastOwnerOwn: "Ett eget projekt behöver minst en ägare. Gör någon annan till ägare innan du lämnar."
  },
  start: {
    button: "Starta kartprojekt",
    title: (fileName: string) => `Starta kartprojekt från ${fileName}`,
    name: "Projektets namn",
    defaultName: (mapName: string) => `${mapName} – revidering`,
    create: "Starta",
    cancel: "Avbryt",
    failed: "Projektet kunde inte startas."
  },
  errors: {
    session: "Du är utloggad. Logga in igen.",
    invalid: "Uppgifterna stämmer inte.",
    forbidden: "Du har inte behörighet till det.",
    notFound: "Kartprojektet finns inte, eller så är du inte med i det.",
    conflict: "Det gick inte: någon annan har ändrat under tiden.",
    generic: (status: number) => `Något gick fel (${status}). Försök igen.`
  }
};
