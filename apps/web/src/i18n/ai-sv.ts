/** ADR-0219 (K2): AI-kopplingen (godkännandet och Konto → AI-kopplingar). */
export const aiSv = {
  authorize: {
    kicker: "O-Tid · AI-koppling",
    title: "Koppla AI till ditt konto",
    checking: "Hämtar begäran …",
    loginNeeded: "Logga in i O-Tid för att godkänna kopplingen. Du kommer tillbaka hit efteråt.",
    login: "Logga in",
    asks: (client: string) => `${client} vill få åtkomst till ditt O-Tid-konto.`,
    account: (email: string) => `Inloggad som ${email}.`,
    can: "Kopplingen kan",
    canItems: {
      kartprojekt: ["se de kartprojekt du är medlem i: kartorna, objekten och bilder av dem",
        "lämna förslag på ändringar, som en ägare i projektet godkänner eller avvisar"],
      banlaggning: ["se banläggningen i tävlingar där du får lägga banor: banor, kontroller, beskrivningar, nivåer och bilder av banorna",
        "lämna notiser i banläggningen (granskning och förslag), som du eller banläggaren läser och tar ställning till"]
    } as Record<string, readonly string[]>,
    cannot: (courseSetting: boolean) => courseSetting
      ? "Kopplingen kan inte ändra en karta eller en bana direkt, se deltagare och resultat eller något annat i O-Tid."
      : "Kopplingen kan inte ändra en karta direkt, se dina tävlingar eller något annat i O-Tid.",
    redirect: (host: string) => `Svaret skickas till ${host}.`,
    revokeHint: "Du kan ta bort kopplingen när som helst under Mitt konto → AI-kopplingar.",
    approve: "Tillåt",
    deny: "Neka",
    sending: "Skickar …",
    invalid: (description: string) => `Begäran kan inte godkännas: ${description}`,
    failed: "Något gick fel. Försök igen från början i AI-tjänsten."
  },
  connections: {
    title: "AI-kopplingar",
    help: "Claude (eller en annan AI-tjänst) som du kopplat med ditt eget konto där. Den ser dina kartprojekt och, om du godkände banläggningen, banorna där du får lägga banor. Den lämnar bara förslag och notiser. En koppling från före den 8 november ser bara kartprojekten; ta bort den och koppla igen för att ge banläggningen.",
    none: "Inga AI-kopplingar. Lägg till O-Tid som anslutning i Claude med adressen nedan.",
    address: "Adress att lägga till i Claude",
    created: (date: string) => `kopplad ${date}`,
    used: (date: string) => `senast använd ${date}`,
    neverUsed: "inte använd än",
    revoked: "borttagen",
    revoke: "Ta bort",
    revokedDone: "Kopplingen är borttagen.",
    failed: "Kopplingarna kunde inte hämtas."
  }
};
