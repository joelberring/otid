import type { Texts } from "../lib/language";
import type { aboutSv } from "./about-sv";
import type { publicRaceSv } from "./public-race-sv";
import type { raceTypeSv } from "./race-type-sv";

/**
 * Idéerna 2026-11-08: engelska, de publika sidorna först (startsidan, sidhuvudet, sidfoten, Om O-Tid och tävlingslistan).
 * Samma form som de svenska texterna.
 */
export const siteEn: { readonly tagline: string } = { tagline: "Course setting and timing for orienteering" };
/** Länken som byter språk: på svenska sidor "English", på engelska "Svenska". */
export const languageSwitch: Readonly<Record<"sv" | "en", { readonly label: string; readonly title: string }>> = {
  sv: { label: "English", title: "Switch to English" },
  en: { label: "Svenska", title: "Byt till svenska" }
};

export const publicHomeEn: Texts<typeof publicRaceSv.home> = {
  title: "Events",
  intro: "Start lists, results and split times from events and trainings timed with O-Tid.",
  searchLabel: "Search events",
  searchPlaceholder: "Event name",
  search: "Search",
  showAll: "Show all",
  searchHeading: query => `Results for “${query}”`,
  ongoing: "Today",
  upcoming: "Upcoming",
  recent: "Recent",
  showMore: "Show more",
  noneOngoing: "No events today.",
  noneUpcoming: "No upcoming events published.",
  noneRecent: "No earlier events.",
  noMatch: query => `No published event matches “${query}”.`,
  myRaces: "My events",
  organizerLogin: "Organisers: sign in",
  accountNavigation: "Account",
  introFilm: "See what O-Tid can do (film, 1 min)"
};

export const publicLinksEn: Texts<typeof publicRaceSv.links> = { startList: "Start list", results: "Results", splits: "Split times" };

export const raceTypeNamesEn: Readonly<Record<keyof typeof raceTypeSv.types, string>> = {
  TRAINING: "Training", SMALL: "Small event", STANDARD: "Event", FORKED: "Event", RELAY: "Relay", ROGAINING: "Rogaining", PARTY: "Party"
};

export const aboutEn: Texts<typeof aboutSv> & { readonly internationalTitle: string; readonly international: readonly string[];
  readonly internationalSuggest: string } = {
  metaTitle: "About O-Tid",
  metaDescription: "O-Tid is course setting and timing for orienteering in the browser, for club events and trainings.",
  kicker: "O-Tid",
  title: "About O-Tid",
  intro: "O-Tid is course setting and timing for orienteering in the browser. It is made for club events and trainings.",
  introMore: "You add courses, classes and entries on the web. At the finish you read out the cards with a SPORTident station. "
    + "Runners see start lists and results on their phones without signing in.",
  film: "Watch the film (1 min)",
  betaTitle: "Beta – free to use",
  beta: "O-Tid is in beta. It is open and free to use. It works, but there may be bugs. Please get in touch if something goes wrong.",
  madeTitle: "How it is made",
  made: "O-Tid is developed by Joel Berring with AI support. It is a web app in Next.js and TypeScript with a PostgreSQL database, "
    + "running on its own server. Card readout happens directly in the browser, with nothing to install.",
  featuresTitle: "Technical features",
  features: [
    "SPORTident readout directly in the browser: Web Serial in Chrome or Edge on a computer, WebUSB in Chrome on an Android tablet. iPhone and iPad do not work.",
    "Cards SI-Card 5, 6, 8, 9, 10, 11 and SIAC. Not every card type has been tried at a real event yet.",
    "Readout without a network: readouts are kept in a local queue in the browser and sent when the network is back.",
    "Eventor: classes, entries and the runner database with the club's runners and cards.",
    "IOF XML 3.0: courses in from course setting programs (Purple Pen, OCAD, Condes), start list and results out.",
    "Start draw with free start, interval start and mass start, vacancies, club separation and advanced rules.",
    "Radio controls via ROC (or OResults) with split times in the lists and for the speaker.",
    "Live for the public with the latest finishers and radio times, split times in the results, a speaker page and runners still in the forest.",
    "Self-registration on the day: runners enter themselves with their card on the event page, marked “self-reg.”.",
    "Party with a bar: purchases with SPORTident cards, check-in and check-out at the bar and a public party page without amounts or names unless the organiser chooses to show them.",
    "Officials with their own accounts who reach readout, start, still in the forest and speaker.",
    "Emergencies during the event: adjust the time of a station, a broken control, manual times and reading again from saved raw data.",
    "Event types Training, Small event, Event (also with forked courses), Relay and Rogaining."
  ],
  capacityTitle: "How big events can O-Tid handle?",
  capacity: [
    "O-Tid runs on a small server with two processor cores and 4 GB of memory. We have tried it with an event with 3,000 runners and 1,000 simultaneous visitors while the last 150 runners finished.",
    "The event comes before the public. Readout got an answer within a second for 95 of 100 cards, and the workspace and officials worked as usual.",
    "When many are watching, the results and Live become slower. A new result usually showed after 5–10 seconds, sometimes a little later.",
    "Relays with 300 teams also work, both with three legs and as a 25-person relay (7,500 leg runners). In a 25-person relay where many teams change at once it can take a few seconds, sometimes up to ten, before readout gets an answer.",
    "Readouts are never lost. Each readout is first saved on the readout computer and removed there only when the server has received it. If the network is down or the server is busy it is sent later.",
    "If you expect more visitors than that O-Tid still works, but the lists are updated less often."
  ],
  contactTitle: "Questions and contact",
  contact: "Questions about O-Tid, found a bug or missing something? Send an email to",
  clubTitle: "Want to use O-Tid in your club?",
  club: "Create an account and set up a training. It costs nothing. If you want help getting started: get in touch.",
  clubLink: "Create an account or sign in",
  privacyLink: "How O-Tid handles personal data",
  internationalTitle: "Clubs outside Sweden",
  international: [
    "Anyone can create an account and use O-Tid for trainings and events, in any country.",
    "Verified clubs (with the club's runners, cards and entries from Eventor) are only available through the Swedish Eventor today. "
      + "It may be possible to support Eventor in more countries, or other entry systems.",
    "Most of the app is still in Swedish; the public pages come first in English."
  ],
  internationalSuggest: "Suggestions for your country are welcome: email",
  footer: { label: "About O-Tid and contact", name: "O-Tid", beta: "beta", questions: "Questions:", about: "About O-Tid", privacy: "Personal data" }
};

/** Del 2: tävlingssidan, start- och resultatlistornas sidor. */
export const publicPagesEn = {
  navigation: "Event navigation",
  back: "‹ Event page",
  startListLink: "To the start list",
  resultsLink: "To the results",
  frozenResultsLink: "Show the official final results",
  live: "Live",
  splitAnalysis: "Split analysis",
  previewBanner: "Preview – not published",
  previewHelp: "Only you and others with access to the event see this page. Publish the event in the workspace when everyone should see it.",
  startListTitle: "Start list",
  startListUnavailable: "No start list can be shown right now. The list may be unpublished or temporarily unavailable.",
  startListLoading: "Fetching the start list…",
  startListHelp: "Planned start, not confirmation of the actual start. The list updates automatically every five seconds.",
  startListRefreshFailed: "The start list could not be updated. The latest fetched list is shown.",
  startListVariantsHidden: "The variant letter is shown when the runner has started.",
  publishedAt: "Published",
  liveUpdating: "Updating live"
} as const satisfies Record<string, string>;

export const hubEn: Texts<typeof publicRaceSv.hub> = {
  navigation: "Event page",
  back: "‹ Event page",
  startList: "Start list",
  startListHelp: "Start times by class, time and club.",
  startListPending: "The start list is not published yet.",
  results: "Results",
  resultsHelp: "Updated as runners read out.",
  resultsPending: "The results show here when the first runners have read out.",
  splits: "Split analysis",
  splitsHelp: "Split times, place per leg and time lost.",
  routes: "Route choices",
  routesHelp: "The runners' route choices on the map. Open from the split analysis.",
  lastUpdate: "Last updated",
  address: "Address of the page"
};
export const hubMoreEn = {
  liveTitle: "Live", liveHelp: "Latest finishers, leaders per class and the runners you follow. Updates by itself.",
  radioTitle: "Radio controls live", radioHelp: "Split times from the forest in the results.",
  metaLists: "Start list, results and split times."
} as const satisfies Record<string, string>;
