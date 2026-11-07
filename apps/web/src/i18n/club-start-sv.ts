import { EVENTOR_KEY_PLACE } from "./club-affiliation-sv";

/**
 * ADR-0209 (ändrat 2026-11-07): "Kom igång" överst i klubbytan och "Be klubbens Eventor-administratör koppla". Texten till
 * administratören har ingen nyckel och inga adresser; nyckeln klistras in direkt i O-Tid av den som har den.
 */
export const clubStartSv = {
  title: "Kom igång",
  freshTitle: (club: string) => `${club} är skapad`,
  freshNext: "Nästa steg: koppla klubbytan till Eventor med klubbens API-nyckel. Det visar att klubbytan är klubbens egen, och medlemmar i Eventor blir bekräftade automatiskt.",
  intro: "Några steg innan klubben kan använda klubbytan. Kortet försvinner när klubbytan är kopplad till Eventor och har minst en karta.",
  progress: (done: number, total: number) => `${done} av ${total} klara`,
  done: "Klart",
  todo: "Att göra",
  next: "Nästa steg",
  hide: "Dölj",
  hideLabel: "Dölj Kom igång",
  steps: {
    eventor: {
      title: "Koppla klubben till Eventor med klubbens API-nyckel",
      help: `Nyckeln finns i Eventor under ${EVENTOR_KEY_PLACE}, och bara klubbens administratörer i Eventor kommer åt den.`,
      linked: (club: string) => `Kopplad till Eventor · ${club}`,
      action: "Klistra in nyckeln",
      noKey: "Har du inte nyckeln?"
    },
    people: {
      title: "Bjud in fler ledare och administratörer",
      help: "Fler som kan bjuda in, bekräfta medlemmar och lägga in träningar, så att klubbytan inte hänger på en person.",
      action: "Till Medlemmar"
    },
    maps: {
      title: "Lägg in kartor eller importera arkivet",
      help: "Ladda upp en kartfil under Kartor, eller importera klubbens mapp med träningar från din dator.",
      upload: "Till Kartor",
      import: "Till Import"
    },
    access: {
      title: "Välj Vem ser vad",
      help: "Förvalet gäller redan: alla medlemmar ser träningsarkivet och får använda kartbanken. Ändra om kartorna bara ska vara för ledare och admin.",
      action: "Till Vem ser vad"
    }
  },
  ask: {
    open: "Be klubbens Eventor-administratör koppla",
    title: "Be klubbens Eventor-administratör koppla",
    intro: "Skicka texten till någon som är administratör för klubben i Eventor. Hen klistrar in nyckeln själv i O-Tid och behöver därför vara administratör i klubbytan: bjud in hen som Administratör under Medlemmar.",
    noSecret: "Texten innehåller ingen nyckel, och nyckeln ska inte skickas till dig. O-Tid skickar ingenting; du skickar texten själv.",
    label: "Texten att skicka",
    copy: "Kopiera texten",
    copied: "Texten är kopierad.",
    copyFailed: "Kunde inte kopiera. Markera texten och kopiera den själv.",
    mail: "Öppna i e-post",
    invite: "Till Medlemmar",
    close: "Stäng",
    subject: (club: string) => `Koppla ${club} i O-Tid till Eventor`,
    body: (club: string, link: string) => [
      "Hej!",
      "",
      `Jag har startat en klubbyta för ${club} i O-Tid. O-Tid är banläggning och tidtagning för orientering i webbläsaren, för klubbtävlingar och träningar, med ett klubbarkiv för klubbens kartor och banor.`,
      "",
      "Klubbytan behöver kopplas till Eventor med klubbens API-nyckel. Kopplingen visar att klubbytan är klubbens egen, och medlemmar som finns i Eventor blir bekräftade automatiskt. Bara klubbens administratörer i Eventor kommer åt nyckeln, så jag behöver din hjälp:",
      "",
      `1. Logga in i Eventor och gå till ${EVENTOR_KEY_PLACE}. Där finns klubbens API-nyckel (skapa en om det inte finns någon).`,
      `2. Öppna klubbytan i O-Tid och logga in: ${link}`,
      "   Du behöver vara administratör i klubbytan. Har du inte fått en inbjudan från O-Tid: svara mig, så bjuder jag in dig.",
      "3. Klistra in nyckeln under fliken Klubben, i fältet Klubbens API-nyckel, och välj Koppla till Eventor.",
      "",
      "Skicka inte nyckeln till mig eller någon annan. O-Tid sparar den krypterad och visar den aldrig igen.",
      "",
      "Tack!"
    ].join("\n")
  }
} as const;
