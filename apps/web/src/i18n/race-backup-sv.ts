import type { RaceBackupCounts, RaceBackupProblem } from "@o-tid/contracts";

const dateTime = (value: Date) => value.toLocaleString("sv-SE", { dateStyle: "long", timeStyle: "short" });
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const megabytes = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} kB`
  : `${(bytes / 1024 / 1024).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} MB`;

/** Säkerhetskopian och återställningen (ADR-0187): Inställningar och Mina tävlingar. */
export const raceBackupSv = {
  title: "Säkerhetskopia",
  help: "En fil med allt om tävlingen: banor, kartfil, klasser, deltagare, brickor, starttider, avläsningar, resultat och historik. " +
    "Går servern sönder kan filen återställas som en ny tävling, också på en annan server.",
  when: "Ta en kopia efter lottningen, en före start och en efter sista målgång.",
  personalDataTitle: "Filen innehåller personuppgifter.",
  personalData: "Namn, klubbar, bricknummer, resultat och e-post för dem som har behörighet. Spara den där bara arrangörerna kommer åt " +
    "den och ta bort den när den inte behövs. Du ansvarar för kopiorna på din dator. Konton, lösenord och Eventor-nyckeln finns inte med.",
  action: "Ladda ner säkerhetskopia",
  downloaded: "Säkerhetskopian är nedladdad.",
  error: "Säkerhetskopian kunde inte skapas. Försök igen.",
  last: (at: Date) => `Senast nedladdad ${dateTime(at)}.`,
  never: "Ingen säkerhetskopia har laddats ner ännu.",
  restoreHint: "Återställ under Mina tävlingar → Återställ tävling från säkerhetskopia.",

  restore: {
    open: "Återställ tävling från säkerhetskopia",
    openHint: "Har servern gått sönder? Läs in en säkerhetskopia som en ny tävling.",
    title: "Återställ tävling från säkerhetskopia",
    intro: "Välj filen (otid-sakerhetskopia-….zip). Den kontrolleras först och visas innan något sparas. " +
      "Tävlingen blir en ny tävling; ingen befintlig tävling ändras.",
    file: "Säkerhetskopia",
    check: "Kontrollera filen",
    checking: "Kontrollerar …",
    previewTitle: "Det här blir en ny tävling",
    createdAt: (at: Date) => `Kopian togs ${dateTime(at)}`,
    formatVersion: (version: number) => `formatversion ${version}`,
    size: (bytes: number) => megabytes(bytes),
    counts: (counts: RaceBackupCounts) => [
      plural(counts.classes, "klass", "klasser"), plural(counts.entries, "deltagare", "deltagare"),
      plural(counts.cardReadouts, "avläsning", "avläsningar"), plural(counts.resultRevisions, "resultatrad", "resultatrader"),
      ...(counts.teams > 0 ? [plural(counts.teams, "lag", "lag")] : []), plural(counts.files, "fil", "filer")
    ].join(" · "),
    map: "Kartan följer med.",
    stale: (count: number) => `${plural(count, "resultat", "resultat")} behövde räknas om när kopian togs och är markerade så också i den ` +
      "nya tävlingen. Räkna om dem efter återställningen.",
    eventor: "Eventor-kopplingen följer med utan klubbens nyckel. Klistra in nyckeln under Inställningar → Eventor.",
    radio: "Radiokontrollerna är avstängda tills du slår på dem under Inställningar.",
    unpublished: "Den nya tävlingen är opublicerad och får en egen kort adress. Publicera den när du har kontrollerat den.",
    peopleTitle: "Personer med behörighet",
    peopleLink: "Bjud in dem med samma roller (de får ett mejl och behörigheten när de loggar in med adressen)",
    peopleSkip: "Bara jag får behörighet",
    peopleNone: "Kopian har inga andra personer med behörighet.",
    roles: { ADMIN: "administratör", FUNCTIONARY: "funktionär", COURSE_EDIT: "banläggning", COURSE_SUGGEST: "banläggning (föreslå)",
      COURSE_COMMENT: "banläggning (kommentera)", COURSE_MAP: "kartritare" } as Record<string, string>,
    fromClub: "En person från klubben (adressen följer inte med och får ingen behörighet här)",
    personalData: "Filen innehåller personuppgifter. Den nya tävlingen får samma uppgifter som kopian.",
    submit: "Skapa tävlingen",
    restoring: "Återställer …",
    cancel: "Avbryt",
    close: "Stäng",
    restored: "Tävlingen är återställd.",
    invited: (count: number) => `${plural(count, "inbjudan", "inbjudningar")} har skapats. Behörigheten gäller när personen loggar in ` +
      "med adressen. Du ser inbjudningarna under Personer med behörighet.",
    openRace: "Öppna tävlingen",
    opening: "Öppnar …",
    problems: {
      NOT_A_BACKUP: () => "Filen är inte en säkerhetskopia från O-Tid. Välj filen som heter otid-sakerhetskopia-….zip.",
      OLD_EXPORT: () => "Filen är den gamla exporten (formatversion 1), som inte kan läsas in. Ladda ner en säkerhetskopia på nytt från tävlingen.",
      UNKNOWN_FORMAT_VERSION: (detail?: string) => `Säkerhetskopian har formatversion ${detail ?? "?"}, som den här servern inte kan läsa ` +
        "(den läser version 2). Den är troligen gjord med en nyare version av O-Tid: uppdatera servern och försök igen.",
      TOO_LARGE: () => "Filen är för stor (högst 200 MB).",
      BROKEN_ARCHIVE: (detail?: string) => `Filen är trasig${detail ? ` (${detail})` : ""}. Ladda ner säkerhetskopian på nytt.`,
      CHECKSUM_MISMATCH: (detail?: string) => `Filen har ändrats eller är ofullständig${detail ? ` (${detail})` : ""}: kontrollsumman stämmer inte.`,
      UNKNOWN_CONTENT: (detail?: string) => `Säkerhetskopian innehåller något som den här versionen av O-Tid inte känner till` +
        `${detail ? ` (${detail})` : ""}. Den är troligen gjord med en nyare version: uppdatera servern och försök igen.`,
      INVALID_CONTENT: (detail?: string) => `Säkerhetskopian har ett fel${detail ? ` i ${detail}` : ""} och kan inte läsas in.`,
      DATA_REJECTED: (detail?: string) => `Databasen godtog inte innehållet${detail ? ` (${detail})` : ""}. Inget har sparats.`,
      STORAGE_QUOTA_EXCEEDED: (detail?: string) => `Kartan i säkerhetskopian får inte plats${detail ? ` (${detail})` : ""}. Ta bort kartor i ` +
        "tävlingar som inte används längre, eller be serverns ägare höja gränsen. Inget har sparats."
    } satisfies Record<RaceBackupProblem["error"], (detail?: string) => string>,
    errors: {
      session: "Du är inte inloggad längre. Logga in och försök igen.",
      conflict: "Försöket gällde en annan fil eller ett annat val. Välj filen igen.",
      network: "Ingen kontakt med servern. Kontrollera nätet och försök igen; samma försök skapar aldrig två tävlingar.",
      generic: (status: number) => `Det gick inte (fel ${status}). Försök igen.`
    }
  }
} as const;
