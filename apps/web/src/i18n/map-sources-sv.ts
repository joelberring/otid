/** ADR-0219 (K4c): kontots egna uppgifter till Lantmäteriet och ortofoton i kartprojektet. */
export const mapSourcesSv = {
  account: {
    title: "Lantmäteriet",
    help: "Dina egna uppgifter till Lantmäteriet, för att hämta ortofoton till kartprojekten. O-Tid har inget eget konto hos Lantmäteriet. "
      + "Uppgifterna sparas krypterade, används bara när du hämtar och visas aldrig igen. Produkten (t.ex. Ortofoto Nedladdning) måste vara beställd på Geotorget.",
    method: "Sätt att logga in",
    basic: "Geotorgets användarnamn och lösenord (privatperson)",
    oauth: "API-portalens nyckel och hemlighet (organisationens systemkonto)",
    id: (method: "BASIC" | "OAUTH2") => method === "BASIC" ? "Användarnamn" : "Nyckel (consumer key)",
    secret: (method: "BASIC" | "OAUTH2") => method === "BASIC" ? "Lösenord" : "Hemlighet (consumer secret)",
    save: "Spara uppgifterna",
    remove: "Ta bort uppgifterna",
    saved: (method: "BASIC" | "OAUTH2", hint: string, date: string) =>
      `Sparat ${date}: ${method === "BASIC" ? "användarnamn" : "nyckel"} som slutar på …${hint}.`,
    unreadable: "Serverns nyckel har bytts sedan uppgifterna sparades. Spara dem igen.",
    none: "Inga uppgifter sparade.",
    notConfigured: "Servern kan inte spara uppgifter (masternyckeln saknas). Kontakta den som driftar O-Tid.",
    savedDone: "Uppgifterna är sparade.",
    removedDone: "Uppgifterna är borttagna.",
    failed: "Det gick inte. Försök igen.",
    trial: "Provas: hämtningen från Lantmäteriet är byggd efter deras guider men inte provad mot riktiga tjänsten ännu."
  },
  ortho: {
    heading: "Ortofoto från Lantmäteriet",
    help: "Sök flygbilder för hela kartan eller en etapp med dina egna uppgifter till Lantmäteriet; de valda läggs till som underlag (en per bildruta). © Lantmäteriet.",
    noCredential: "Lägg in dina uppgifter till Lantmäteriet under Mitt konto först.",
    account: "Mitt konto",
    where: "Område",
    whole: "Hela kartan",
    search: "Sök ortofoton",
    searching: "Söker …",
    none: "Inga ortofoton hittades för området.",
    item: (when: string | null, collection: string | null, id: string) => [when?.slice(0, 10), collection, id].filter(Boolean).join(" · "),
    add: (count: number) => count === 1 ? "Lägg till 1 bild som underlag" : `Lägg till ${count} bilder som underlag`,
    adding: (done: number, total: number) => `Hämtar bild ${done} av ${total} …`,
    added: (count: number) => count === 1 ? "1 underlag tillagt." : `${count} underlag tillagda.`,
    name: (collection: string | null, id: string) => `Ortofoto ${collection ?? ""} ${id}`.replace(/\s+/g, " ").trim().slice(0, 80),
    problems: {
      SOURCE_NO_CREDENTIAL: "Lägg in dina uppgifter till Lantmäteriet under Mitt konto först.",
      SOURCE_REJECTED: "Lantmäteriet godtog inte uppgifterna, eller produkten är inte beställd på Geotorget.",
      SOURCE_AREA_TOO_LARGE: "Området är för stort för en sökning. Välj en etapp.",
      SOURCE_THROTTLED: "För många sökningar den senaste timmen. Försök igen senare.",
      SOURCE_UNAVAILABLE: "Lantmäteriet svarade inte just nu. Försök igen om en stund.",
      OUTSIDE: "Bilden täcker inte området.",
      generic: (status: number | string) => `Det gick inte (${status}).`
    }
  }
} as const;
