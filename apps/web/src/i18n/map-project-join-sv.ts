/** Ägaren 2026-11-13: bjud in till ett kartprojekt utan e-post (klubbmedlemmar och länk) och sidan som tar emot länken. */
export const mapProjectJoinSv = {
  members: {
    title: "Klubbmedlemmar",
    help: (clubs: readonly string[]) => `Lägg till en medlem i ${clubs.join(", ")} direkt, utan e-post. Bara namn visas, och bara från dina klubbar.`,
    search: "Sök på namn",
    role: "Roll",
    add: "Lägg till",
    addLabel: (name: string) => `Lägg till ${name}`,
    added: (name: string) => `${name} är nu med i projektet.`,
    none: "Inga fler klubbmedlemmar att lägga till.",
    noMatch: "Ingen klubbmedlem med det namnet.",
    loading: "Läser klubbmedlemmarna …",
    failed: "Det gick inte att läsa klubbmedlemmarna.",
    gone: "Personen kan inte läggas till (hen är kanske redan med).",
    from: (clubs: readonly string[]) => clubs.join(", ")
  },
  link: {
    title: "Länk",
    help: "Skapa en länk med en roll. Den som öppnar länken inloggad blir medlem. Länken gäller i 14 dagar, kan användas av flera och kan tas bort.",
    create: "Skapa länk",
    created: "Länken är skapad. Den visas bara nu: kopiera den och skicka den.",
    copied: "Länken är kopierad.",
    field: "Länk att skicka",
    copy: "Kopiera länken",
    open: "Öppna länkar",
    none: "Inga öppna länkar.",
    line: (role: string, until: string) => `${role}, gäller till ${until}`,
    remove: "Ta bort länken",
    removeLabel: (role: string, until: string) => `Ta bort länken (${role}, till ${until})`,
    removed: "Länken är borttagen. De som redan gått med står kvar.",
    tooMany: "Det finns redan tjugo öppna länkar. Ta bort någon först.",
    failed: "Det gick inte att skapa länken."
  },
  page: {
    kicker: "Kartprojekt",
    title: "Gå med i kartprojektet",
    checking: "Kontrollerar länken …",
    noToken: "Länken saknar nyckel. Öppna länken du fick igen, eller be om en ny.",
    failed: "Det gick inte att kontrollera länken. Försök igen.",
    invalidTitle: "Länken gäller inte",
    invalid: "Länken är borttagen eller har gått ut. Be om en ny länk av den som skickade den.",
    invited: (inviter: string | null, project: string, role: string) =>
      `${inviter ?? "Någon"} har bjudit in dig till kartprojektet ${project} som ${role}.`,
    validUntil: (until: string) => `Länken gäller till ${until}.`,
    signedOut: "Logga in eller skapa ett konto i O-Tid och öppna sedan länken igen.",
    join: "Gå med",
    joining: "Går med …",
    joined: (project: string) => `Du är med i ${project}.`,
    open: "Öppna projektet",
    verify: "Bekräfta din e-postadress först (länken i mejlet du fick när du skapade kontot) och öppna sedan länken igen.",
    refused: "Länken gäller inte längre eller kontot får inte gå med."
  }
};
