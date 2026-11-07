import type { MapProjectRole } from "@o-tid/contracts";
import { plural } from "./plural";

/** ADR-0219: kartprojekten (steg K0). Ritverktygen kommer i K1; här finns projektet, medlemmarna, filerna och nya versioner. */
export const mapProjectSv = {
  title: "Kartprojekt",
  list: {
    title: "Mina kartprojekt",
    hint: "Kartprojekt där flera ritar på samma kartversion. Ett projekt startas från en kartversion i klubbarkivet.",
    empty: "Du är inte med i något kartprojekt än. En administratör i klubben startar ett från kartbanken i klubbarkivet.",
    changed: (count: number) => plural(count, "ändrat objekt", "ändrade objekt"),
    closed: "avslutat"
  },
  roles: { OWNER: "Ägare", EDIT: "Ändra", READ: "Läsa" } satisfies Record<MapProjectRole, string>,
  roleHelp: {
    OWNER: "allt: medlemmar, namn, avsluta och nya kartversioner",
    EDIT: "ritar och ändrar kartan",
    READ: "ser kartan och ändringarna"
  } satisfies Record<MapProjectRole, string>,
  page: {
    kicker: "O-Tid · Kartprojekt",
    loading: "Hämtar kartprojektet …",
    base: "Grundversion",
    club: "Klubb",
    changes: "Ändringar",
    changed: (count: number) => plural(count, "ändrat objekt", "ändrade objekt"),
    closed: "Projektet är avslutat. Ingen kan ändra kartan förrän det öppnas igen.",
    drawingSoon: "Att rita och ändra kartan i O-Tid kommer i nästa steg. Här finns projektet, medlemmarna och filerna.",
    ocadLater: "Grundfilen är en OCAD-fil. Att skriva tillbaka till OCAD kommer senare; exportera ändringarna som GeoJSON så länge.",
    download: "Ladda ner grundfilen",
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
    outputLine: (fileName: string, changes: number, date: string) => `${fileName} · ${plural(changes, "ändring", "ändringar")} · ${date}`
  },
  version: {
    title: "Ny kartversion",
    help: "Skriver ändringarna in i en kopia av grundfilen. Bara de ändrade objekten skrivs om, och filen kontrolleras efteråt. Grundversionen ändras aldrig; den nya versionen hamnar i klubbarkivet bredvid.",
    button: "Skapa ny kartversion",
    confirm: "Skapa en ny kartversion i klubbarkivet med projektets ändringar?",
    created: (fileName: string) => `Ny kartversion i klubbarkivet: ${fileName}.`,
    same: (fileName: string) => `Inget har ändrats sedan förra versionen (${fileName}).`,
    empty: "Det finns inga ändringar att skriva.",
    refused: "Ändringarna kunde inte skrivas in i kartfilen. Exportera dem i stället:",
    conflict: "Någon ändrade kartan medan filen skrevs. Försök igen.",
    notAdmin: "Bara en ägare av projektet som också är administratör i klubben kan skapa en ny kartversion."
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
    clubAdmins: "Klubbens administratörer och ägare har alltid samma rätt som projektets ägare."
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
