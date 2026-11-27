import type { HelpView } from "../../i18n/help-sv";

/**
 * Lättviktig metadata för alla hjälpartiklar (~10 KB rå / ~3 KB gzip) så `HelpButton` och `HelpLink` kan rendera
 * knapp, `aria-label`/`title` och vy-lista utan att statiskt ladda de stora brödtexterna i `help-sv.ts` / `help-en.ts`.
 * Hålls i exakt paritet med `helpArticles` och `helpArticlesEnById` av `help-panel.test.tsx`.
 */
export type HelpArticleMeta = {
  readonly id: string;
  readonly sv: string;
  readonly en: string;
  readonly views: readonly HelpView[];
};

const RAW_META: readonly (readonly [id: string, sv: string, en: string, views: readonly HelpView[]])[] = [
  ["skapa-tavling", "Skapa en tävling och välj typ", "Create an event and choose its type", ["EVENTS", "SETTINGS"]],
  ["publicera", "Publicera tävlingen", "Publish the event", ["PUBLISH", "SETTINGS"]],
  ["banor", "Banor", "Courses", ["COURSES"]],
  ["traning", "Träningsformer i banläggningen", "Training forms in course setting", ["CS_TRAINING", "COURSES"]],
  ["klasser", "Klasser", "Classes", ["CLASSES", "COURSES"]],
  ["anmalda", "Anmälda", "Entries", ["ENTRIES", "SETTINGS"]],
  ["start", "Start och lottning", "Start and draw", ["START"]],
  ["avlasning", "Avläsning med station", "Readout with a station", ["READOUT_PAGE", "READOUT"]],
  ["okand-bricka", "Okänd bricka, direktanmälan och lånad bricka", "Unknown card, direct entry and borrowed card", ["READOUT_PAGE", "READOUT"]],
  ["nodlagen", "Nödlägen under tävlingen", "Emergencies during the event", ["READOUT", "RESULTS", "ENTRIES"]],
  ["status", "Ej start, brutit, disk och andra statusval", "Did not start, did not finish, disqualified and other statuses", ["ENTRIES", "READOUT", "RESULTS"]],
  ["resultat", "Resultat och export", "Results and export", ["RESULTS"]],
  ["arbetsytan-telefon", "Arbetsytan i telefonen", "The workspace on the phone", ["COURSES", "ENTRIES", "START", "PUBLISH", "READOUT", "RESULTS", "PEOPLE", "SETTINGS"]],
  ["funktionarer", "Funktionärer", "Officials", ["PEOPLE", "SETTINGS", "EVENTS"]],
  ["inbjudningar", "Inbjudningar med e-post", "Invitations by email", ["PEOPLE", "SETTINGS", "EVENTS", "ARCHIVE_MEMBERS"]],
  ["live", "Live, speaker och kvar i skogen", "Live, speaker and still out", ["READOUT", "RESULTS", "PUBLISH"]],
  ["radio", "Radiokontroller", "Radio controls", ["SETTINGS", "RESULTS"]],
  ["si-enheter", "SPORTident-enheter före tävlingen", "SPORTident units before the event", ["READOUT_PAGE", "READOUT", "START"]],
  ["fest-bardisk", "Fest och bardisk", "Party and bar counter", ["PARTY", "READOUT_PAGE", "EVENTS"]],
  ["rogaining", "Rogaining: kontroller med poäng", "Rogaining: controls with points", ["COURSES", "CS_COURSES"]],
  ["sjalvregistrering", "Självregistrering på tävlingsdagen", "Self-registration on the day of the event", ["PARTY", "SETTINGS", "PUBLISH"]],
  ["kom-igang-traning", "Kom igång: lägga en träning på 10 minuter", "Get started: set a training in 10 minutes", ["CS_START", "EVENTS", "COURSE_SETTING", "COURSES"]],
  ["kom-igang-purple-pen", "Kom igång: från Purple Pen till tävling", "Get started: from Purple Pen to an event", ["CS_START", "EVENTS", "COURSE_SETTING"]],
  ["banlaggning-start", "Banläggningen: öppna den och läs in kartan", "Course setting: open it and load the map", ["CS_START", "COURSE_SETTING", "COURSES"]],
  ["purple-pen", "Purple Pen, OCAD och IOF XML", "Purple Pen, OCAD and IOF XML", ["CS_START", "COURSE_SETTING"]],
  ["kontroller-banor", "Kontroller och banor: verktygen", "Controls and courses: the tools", ["CS_COURSES", "CS_SELECTED", "COURSE_SETTING"]],
  ["alla-kontroller", "Alla kontroller och oanvända kontroller", "All controls and unused controls", ["CS_COURSES"]],
  ["gaffling", "Gaffling och slinga", "Fork and loop", ["CS_COURSES", "CS_SELECTED"]],
  ["varianter", "Färre varianter", "Fewer variants", ["CS_COURSES"]],
  ["objekt", "Obligatorisk passage och specialobjekt", "Mandatory crossing point and special objects", ["CS_OBJECTS", "CS_SELECTED"]],
  ["banans-egenskaper", "Banans egenskaper: stigning, längd och poängbana", "The course's properties: climb, length and score course", ["CS_COURSES"]],
  ["kontrollbeskrivning", "Kontrollbeskrivning (kartdef)", "Control description (clue sheet)", ["CS_DESCRIPTION", "CS_SELECTED", "CS_DESCRIPTIONS_PAGE"]],
  ["beskrivningsforslag", "Förslag på kontrollbeskrivning ur kartan", "Control description suggestions from the map", ["CS_DESCRIPTION", "CS_FIELD"]],
  ["varningar", "Varningar", "Warnings", ["CS_CHECKS"]],
  ["notiser", "Notiser och kartfel", "Notes and map errors", ["CS_NOTES", "CS_FIELD"]],
  ["kartritarens-lank", "Dela kartfelen med kartritaren", "Share the map errors with the mapper", ["CS_NOTES", "CS_FIELD"]],
  ["samarbete", "Flera banläggare samtidigt", "Several course setters at once", ["CS_SETTINGS", "CS_SUGGESTIONS", "COURSE_SETTING"]],
  ["sparande", "Sparande, versioner och ångra", "Saving, versions and undo", ["COURSE_SETTING", "CS_SETTINGS"]],
  ["forslag", "Förslag från andra banläggare", "Suggestions from other course setters", ["CS_SUGGESTIONS"]],
  ["utseende", "Banans utseende och ringklipp", "The course's appearance and circle cut-outs", ["CS_SETTINGS"]],
  ["overfor", "Överför banorna till tävlingen", "Transfer the courses to the event", ["COURSE_SETTING", "COURSES"]],
  ["nivastod", "Nivåstöd – grön, vit, gul …", "Level support – green, white, yellow …", ["CS_COURSES", "COURSE_SETTING"]],
  ["niva-gron", "Så lägger du en grön bana", "How to set a green course", ["CS_COURSES"]],
  ["niva-vit", "Så lägger du en vit bana", "How to set a white course", ["CS_COURSES"]],
  ["niva-gul", "Så lägger du en gul bana", "How to set a yellow course", ["CS_COURSES"]],
  ["niva-orange", "Så lägger du en orange bana", "How to set an orange course", ["CS_COURSES"]],
  ["niva-violett", "Så lägger du en violett bana", "How to set a violet course", ["CS_COURSES"]],
  ["niva-bla-svart", "Så lägger du en blå eller svart bana", "How to set a blue or black course", ["CS_COURSES"]],
  ["faltlaget", "Fältläget i telefonen (hänga kontroller)", "Field mode on the phone (hanging controls)", ["CS_FIELD", "CS_INSPECTIONS"]],
  ["kollat", "Kollat: kontroller som är kontrollerade på plats", "Checked: controls verified on site", ["CS_INSPECTIONS", "CS_FIELD"]],
  ["utan-nat", "Utan nät i skogen (offline)", "Without network in the forest (offline)", ["CS_FIELD", "CS_SETTINGS"]],
  ["utskrift", "Utskrift och förhandsvisning", "Print and preview", ["CS_PRINT", "CS_PRINT_PAGE"]],
  ["arket", "Papper och kartram", "Paper and map frame", ["CS_PRINT_PAGE"]],
  ["kartor-per-ark", "Kartor per ark", "Maps per sheet", ["CS_PRINT_PAGE"]],
  ["beskrivning-pa-kartan", "Kontrollbeskrivningen på kartan", "The control description on the map", ["CS_PRINT_PAGE", "CS_PRINT", "CS_DESCRIPTION"]],
  ["papperet", "Papperet: texter, bilder, skalstock och nordpil", "The paper: texts, images, scale bar and north arrow", ["CS_PRINT_PAGE", "CS_PRINT"]],
  ["papperets-mallar", "Mall för papperet och klippning av kartan", "Paper template and cropping the map", ["CS_PRINT_PAGE"]],
  ["bl-farger", "Färger för tryck", "Colours for print", ["CS_PRINT_PAGE", "CS_PRINT"]],
  ["pdf-tryck", "PDF för tryck och spegelvänd karta", "PDF for print and mirrored map", ["CS_PRINT_PAGE", "CS_PRINT"]],
  ["lopar-kartor", "En karta per löpare: variabler, baksida och kontroll", "One map per runner: variables, back and check", ["CS_PRINT_PAGE"]],
  ["kartbyten", "Kartbyten: delar, dubbelsidigt och överlapp", "Map exchanges: parts, double-sided and overlap", ["CS_PRINT_PAGE", "CS_PRINT"]],
  ["vagval-strackan", "Vägval i banläggningen", "Route choice in course setting", ["CS_SELECTED", "CS_COURSES"]],
  ["kontrollkarta", "Kontrollkartan", "The control map", ["CONTROL_MAP", "COURSES"]],
  ["vagval", "Vägvalsanalysen: så räknas den", "The route choice analysis: how it is calculated", ["ROUTE_CHOICE", "CONTROL_MAP"]],
  ["vagval-installningar", "Vägvalens inställningar och spärrar", "The route choices' settings and barriers", ["ROUTE_CHOICE"]],
  ["vagval-kalibrering", "Justera farterna efter löparnas GPS-rutter", "Adjust the speeds to the runners' GPS routes", ["ROUTE_CHOICE"]],
  ["vagval-publicera", "Visa bästa vägval publikt", "Show best route choices publicly", ["ROUTE_CHOICE"]],
  ["klubbarkiv", "Klubbarkivet", "The club archive", ["ARCHIVE_TRAININGS", "ARCHIVE_ENTRY", "EVENTS"]],
  ["anvand-igen", "Använd en träning igen", "Use a training again", ["ARCHIVE_ENTRY", "ARCHIVE_TRAININGS"]],
  ["arkiv-kartor", "Kartor, versioner och rättigheter", "Maps, versions and rights", ["ARCHIVE_MAPS", "ARCHIVE_ENTRY"]],
  ["arkiv-dubbletter", "Dubbletter och versioner av kartor", "Duplicates and versions of maps", ["ARCHIVE_MAPS", "CS_START", "EVENTS"]],
  ["arkiv-bilder", "Bilder och kontroll av kartorna", "Images and check of the maps", ["ARCHIVE_MAPS", "ARCHIVE_TRAININGS"]],
  ["arkiv-medlemmar", "Medlemmar i klubbarkivet", "Members of the club archive", ["ARCHIVE_MEMBERS"]],
  ["arkiv-import", "Importera till klubbarkivet från datorn", "Import to the club archive from your computer", ["ARCHIVE_IMPORT"]],
  ["mina-klubbar", "Mina klubbar", "My clubs", ["EVENTS"]],
  ["klubben-i-eventor", "Koppla klubbytan till Eventor", "Link the club space to Eventor", ["ARCHIVE_CLUB"]],
  ["klubbytan-kom-igang", "Kom igång med klubbytan", "Get started with the club space", ["ARCHIVE_TRAININGS", "ARCHIVE_CLUB"]],
  ["klubbens-enheter", "Läsa ut och ställa in enheter, och klubbens enhetsregister", "Reading out and setting up units, and the club's unit register", ["ARCHIVE_DEVICES", "READOUT_PAGE"]],
  ["bekrafta-medlemmar", "Bekräfta medlemmar och Vem ser vad", "Confirm members and Who sees what", ["ARCHIVE_CLUB", "ARCHIVE_MEMBERS"]],
  ["bjud-in-fran-klubben", "Bjuda in från klubben", "Invite from the club", ["SETTINGS", "ARCHIVE_MEMBERS"]],
  ["tavling-i-klubbarkivet", "Lägga en tävling i klubbarkivet", "Put an event in the club archive", ["SETTINGS", "RESULTS", "ARCHIVE_TRAININGS"]],
  ["terminsplanering", "Planera terminen och ge ut uppgifter", "Plan the term and hand out tasks", ["ARCHIVE_PLANNING", "EVENTS"]],
  ["klubbens-nyheter", "Klubbens nyheter", "Club news", ["ARCHIVE_NEWS"]],
  ["konto", "Skapa konto och bekräfta e-postadressen", "Create an account and confirm the email address", ["EVENTS"]],
  ["glomt-losenord", "Glömt lösenordet", "Forgot password", ["EVENTS"]],
  ["google", "Logga in med Google", "Sign in with Google", ["EVENTS"]],
  ["google-koppla", "Koppla Google-konto", "Link Google account", ["EVENTS"]],
  ["logga-ut", "Logga ut och lånade datorer", "Sign out and borrowed computers", ["EVENTS", "COURSE_SETTING", "CS_PRINT_PAGE"]],
  ["ritlaget-sa-tanker-du", "Så tänker du i ritläget", "How to think in the drawing mode", ["MAP_EDITOR"]],
  ["ritlaget-arbetsgang", "Från laserdata till färdig karta", "From laser data to a finished map", ["MAP_EDITOR"]],
  ["ritlaget-huvudkalla", "Baskarta och OpenStreetMap utan dubbletter", "Base map and OpenStreetMap without duplicates", ["MAP_EDITOR"]],
  ["ritlaget-redigera", "Redigera en karta som redan finns", "Edit a map that already exists", ["MAP_EDITOR"]],
  ["lantmateriet-koppla", "Så kopplar du Lantmäteriet", "How to connect Lantmäteriet", ["MAP_EDITOR"]],
  ["ritlaget-lager", "Släcka, tona och låsa lager", "Turn off, fade and lock layers", ["MAP_EDITOR"]],
  ["ritlaget-punkter-tangenter", "Punkter, tangenter och hjulet", "Points, keys and the wheel", ["MAP_EDITOR"]],
  ["ritlaget-markera-flera", "Markera, flytta och vrida flera objekt", "Select, move and rotate several objects", ["MAP_EDITOR"]]
];

export const HELP_ARTICLE_META: readonly HelpArticleMeta[] = RAW_META.map(([id, sv, en, views]) => ({ id, sv, en, views }));

const META_BY_ID = new Map(HELP_ARTICLE_META.map(row => [row.id, row]));

export function findHelpMeta(id: string): HelpArticleMeta | undefined {
  return META_BY_ID.get(id);
}

export const helpMetaText = {
  sv: {
    button: "Hjälp",
    title: "Hjälp",
    close: "Stäng",
    loading: "Hämtar hjälpen…",
    failed: "Hjälpen kunde inte hämtas.",
    retry: "Försök igen",
    link: (title: string) => `Hjälp: ${title}`
  },
  en: {
    button: "Help",
    title: "Help",
    close: "Close",
    loading: "Loading help…",
    failed: "Could not load the help.",
    retry: "Try again",
    link: (title: string) => `Help: ${title}`
  }
} as const;
