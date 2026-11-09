import type { Texts } from "../lib/language";
import { sv } from "./sv";
import type { aboutSv } from "./about-sv";
import type { publicRaceSv } from "./public-race-sv";
import type { raceTypeSv } from "./race-type-sv";
import type { liveSv } from "./live-sv";
import type { raceInfoSv } from "./race-info-sv";
import type { splitAnalysisSv } from "./split-analysis-sv";
import type { selfRegistrationSv } from "./self-registration-sv";

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

/** Del 3: Live och tävlingsinfon. */
export const ordinalEn = (place: number): string => {
  const lastTwo = place % 100, last = place % 10;
  return `${place}${lastTwo >= 11 && lastTwo <= 13 ? "th" : last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th"}`;
};
export const liveEn: Texts<typeof liveSv> = {
  title: "Live",
  metaTitle: event => `Live – ${event}`,
  heading: race => `${race} · Live`,
  results: "Results",
  updated: time => `Updated ${time}`,
  offline: time => `No connection right now – showing the state from ${time}. The page tries again by itself.`,
  empty: "No finishers yet – the page updates by itself.",
  emptyHelp: "Here you see the latest finishers, the leader of each class and passings at the radio controls.",
  latestTitle: "Latest finishers",
  leadersTitle: "Leaders per class",
  leadersEmpty: "No approved finisher yet.",
  newLeader: "New leader",
  radioTitle: "At the radio controls",
  radioEmpty: "Nobody has passed a radio control yet.",
  passed: (control, time, place) => `passed ${control}${time ? ` ${time}` : ""}${place !== null ? `, ${ordinalEn(place)}` : ""}`,
  followingTitle: "Following",
  followingHelp: "Tap ☆ next to a runner to follow them. The choice is saved only in this browser.",
  notFinished: "Not finished yet",
  clubNone: club => `Nobody from ${club} has finished yet.`,
  followClub: "Follow a club",
  chooseClub: "Choose club",
  followClubButton: "Follow",
  clubRegion: club => `Club ${club}`,
  noClub: "No club",
  statuses: { OK: "OK", OVERTIME: "Over time", MP: "Mispunch", DSQ: "Disq.", OOC: "Not competing", NT: "Took part" },
  hubTitle: "Live",
  hubHelp: "Latest finishers, leaders per class and the runners you follow. Updates by itself."
};
export const raceInfoViewEn: Texts<typeof raceInfoSv.view> = { title: "About the event", firstStart: "First start" };

/** Del 3: sträcktidsanalysen. */
export const splitAnalysisEn: Texts<typeof splitAnalysisSv> = {
  title: "Split analysis",
  back: "To the results",
  classLabel: "Class",
  views: { SPLITS: "Split times", LOSS: "Time lost" },
  viewLabel: "Show",
  help: "Leg time and place on the leg on top, loss against the best leg below and total time with place at the bottom. "
    + "Tap a leg to sort on it. The best leg is bold and marked ★.",
  helpForked: "The class has forked courses. Legs are compared within the same variant, since the variants have different legs.",
  helpForkedLegs: "The class has forked courses. Each leg (control pair) is compared between everyone who ran it, regardless of variant. Choose By variant for a table per variant.",
  helpMispunched: "Mispunched and others without an approved result are listed below the approved, without places. Legs they ran are shown; "
    + "– means the time is missing.",
  helpRoutes: "Route choices: tap the link in a leg to see the runner's route on the map.",
  relayNotSupported: classes => `Split analysis is not available for relays yet (${classes}). The leg results are in the results.`,
  none: "No class has split times yet.",
  noClass: "The class does not exist or has no split times.",
  variantHeading: (className, variant) => `${className} · variant ${variant}`,
  runners: count => `${count} ${count === 1 ? "runner" : "runners"}`,
  place: "Pl", name: "Name", time: "Time", loss: "Lost", ideal: "Ideal time",
  lossHelp: "Time lost: the sum of the losses against the best leg on each leg. Runners missing a leg get no sum.",
  start: "Start", finish: "Finish",
  legNumber: index => String(index + 1),
  control: (code, occurrence) => `${code}${occurrence > 1 ? ` (${occurrence})` : ""}`,
  sortBy: leg => `Sort on leg ${leg}`,
  sortReset: "Sort on result",
  sortedBy: leg => `Sorted on leg ${leg}.`,
  bestLeg: "best leg",
  legPlace: place => `(${place})`,
  lossValue: value => `+${value}`,
  gainValue: value => `−${value}`,
  missing: "–",
  missingLabel: "time missing",
  route: "Route",
  routeLabel: (name, leg) => `Route choice for ${name} on leg ${leg}`,
  status: { OK: "OK", OVERTIME: "Over time", MP: "Mispunch", DSQ: "Disqualified", DNF: "Did not finish", OOC: "Not competing", DNS: "Did not start",
    NT: "Took part" },
  legName: (from, to) => `${from}–${to}`
};

/** Del 3: löparens resultatsida (svenskan ur `sv.ts`, samlad här så att båda språken har samma form). */
export const publicResultSv = {
  unavailable: sv.publicResultUnavailable, back: sv.publicResultBack, position: sv.publicResultsPosition, status: sv.publicResultsStatus,
  time: sv.publicResultsTime, behind: sv.publicResultsTimeBehind, statusLabels: sv.publicResultsStatusLabels, reasonLabels: sv.publicResultsReasonLabels,
  missing: sv.publicResultsMissingControls, extra: sv.publicResultsExtraPunches, showSplits: sv.publicResultsShowSplits,
  control: sv.publicResultsControl, leg: sv.publicResultsLeg, total: sv.publicResultsTotal
};
export const publicResultEn: Texts<typeof publicResultSv> = {
  unavailable: "The result is no longer published.", back: "To the results", position: "Place", status: "Status", time: "Time", behind: "Behind",
  statusLabels: { OK: "OK", OVERTIME: "Over time", MP: "Mispunch", DSQ: "Disqualified", DNF: "Did not finish", OOC: "Not competing", DNS: "Did not start",
    NT: "Took part" },
  reasonLabels: {
    COMPLETE: "Approved result",
    MAX_TIME_EXCEEDED: "The running time is longer than the class's maximum time",
    MISSING_START: "Start missing",
    MISSING_FINISH: "Finish missing",
    MISSING_CONTROL: "A required control is missing",
    WRONG_ORDER: "The controls are in the wrong order",
    INVALID_TIME_ORDER: "The time order is invalid",
    DID_NOT_START: "Marked as did not start by the organiser",
    DID_NOT_FINISH: "Marked as did not finish by the organiser",
    OUT_OF_COMPETITION: "Marked as not competing by the organiser",
    MANUAL_DISQUALIFICATION: "Disqualified manually by the organiser",
    MANUAL_APPROVAL: "Approved manually by the organiser",
    WITHOUT_TIMING: "Took part without time"
  },
  missing: "Missing", extra: "Extra", showSplits: "Show split times", control: "Control", leg: "Leg", total: "Total"
};

/** Del 3: självregistreringens publika formulär (inte arbetsytans inställning och städning). */
type SelfRegistrationForm = Omit<typeof selfRegistrationSv, "setting" | "settingTitle" | "selfRegistered" | "cleanup">;
export const selfRegistrationEn: Texts<SelfRegistrationForm> = {
  title: "Register your card",
  intro: {
    party: "Enter the number of your card (SPORTident) and your name, so the bar recognises you.",
    race: "Enter the number of your card, your name and choose a class, and you are entered."
  },
  cardNumber: "Card number",
  cardHelp: "The digits on the card, for example 8123456.",
  givenName: "First name",
  familyName: "Last name",
  club: "Club (optional)",
  displayName: "Display name (optional)",
  displayNameHelp: example => `Shown on the party page and at the bar. The full name is never shown there. Empty: ${example}.`,
  receiptDisplayName: name => `You are shown as ${name}.`,
  className: "Class",
  chooseClass: "Choose class",
  submit: "Register",
  saving: "Registering …",
  privacy: {
    race: "Name, club and class are shown in the public start list and results, marked “self-reg.”.",
    party: "The name is linked to the card and seen by the organiser and at the bar. The party page shows no names.",
    partyNames: "Your purchases are shown with your display name on this page. The full name is seen only by the organiser and at the bar."
  },
  privacyLink: "About personal data",
  receipt: (card, name) => `Done! Card ${card} is linked to ${name}.`,
  receiptClass: className => `You are entered in ${className}.`,
  again: "Register another card",
  trap: "Leave empty",
  errors: {
    cardNumber: "Write the card number in digits (1–9,999,999).",
    givenName: "Write your first name (at most 60 characters).",
    familyName: "Write your last name (at most 60 characters).",
    club: "The club may be at most 80 characters and contain letters.",
    classId: "Choose a class.",
    displayName: "The display name may be at most 40 characters and contain letters.",
    taken: "The card is already registered. Contact the organiser.",
    hasPurchases: "The card already has purchases tonight – go to the bar and the staff will help you.",
    full: "The class is full. Choose another class or contact the organiser.",
    closed: "Self-registration is closed right now.",
    rateLimited: "Too many registrations in a short time. Wait a few minutes and try again.",
    failed: "The registration could not be saved. Try again."
  }
};
