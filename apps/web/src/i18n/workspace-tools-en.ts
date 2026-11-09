import type { Texts } from "../lib/language";
import { plural } from "./plural";
import type { startDrawSv } from "./start-draw-sv";
import type { startListPublicationSv } from "./start-list-publication-sv";
import type { forestWatchSv } from "./forest-watch-sv";
import type { sourcesSv } from "./sources-sv";
import type { removalSv } from "./removal-sv";
import type { resultsOfficialSv } from "./results-official-sv";
import type { raceCopySv } from "./race-copy-sv";
import type { courseVariantsSv } from "./course-variants-sv";
import { startRuleEn as rule } from "./workspace-admin-en";

/** Engelska, arbetsytan del 4–6: lottningen, publiceringen, kvar i skogen, källorna, ta bort, resultaten klara, kopiera och gafflingarna. */
const names = (list: readonly string[]) =>
  list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;

/** Engelska, arbetsytan del 4: lottningen. */
export const startDrawEn: Texts<typeof startDrawSv> = {
  title: "Draw",
  help: "Set start type, interval and vacancies once for all classes and press Use for all. Then change only the classes that should differ. Classes whose courses have the same first control never start the same minute. Vacancies are spread in the class and late entries get the first free vacant time.",
  load: "Show the classes", loading: "Loading the classes…",
  first: "First start (clock)", firstExample: "10:00",
  firstHelp: "The event's first start. Saved with the draw and shown to the runners (also under Settings).",
  common: {
    title: "Common for the classes",
    help: "The values are applied to all classes, or only to the ticked ones. Then change single classes in the table.",
    methodLabel: "Start type for the classes", intervalLabel: "Interval (min) for the classes", vacanciesLabel: "Vacancies for the classes",
    vacancyKindLabel: "Vacancies for the classes as",
    laterStart: "The classes' first start (optional)",
    laterStartHelp: "Clock time if the classes should start later than the event's first start. Empty = as before.",
    applyAll: "Use for all",
    applySelected: count => `Use for chosen (${count})`,
    applied: count => count === 1 ? "The settings now apply to 1 class." : `The settings now apply to ${count} classes.`,
    noneSelected: "Tick the classes first, or use for all."
  },
  selectAll: "Draw all classes",
  laterStartShort: time => `First start ${time}`,
  clubSeparation: "Club separation: two from the same club do not start after each other",
  className: "Class", method: rule.label, interval: "Interval (min)", vacancies: "Vacancies", draw: "Draw", entries: "Entries",
  methods: rule.methods,
  vacancyKinds: { COUNT: "pcs", PERCENT: "%" },
  vacancyKind: "Vacancies as",
  hasTimes: "Has start times",
  drawClass: className => `Draw ${className}`,
  preview: "Show draw", save: "Save the draw", replaceAndSave: "Replace the start times and save", cancel: "Change the settings",
  noneSelected: "Tick at least one class to draw.",
  invalid: "Write the first start as a clock time (for example 10:00), interval 1–60 minutes and vacancies as a whole number (at most 100 %).",
  error: "Could not show the draw. Try again.",
  saveError: "The draw could not be saved. Show the draw again.",
  unknown: "Could not reach the server. The app tries again when you press the button.",
  conflict: "Something has changed since the draw was shown. Show the draw again.",
  saved: "The draw is saved. If the start list has already been published it needs to be published again.",
  previewTitle: "This is the start list",
  previewHelp: "One row per class. Open a class to see the runners and times.",
  expandAll: "Show all runners", collapseAll: "Hide all runners",
  summaryClass: "Class", summaryMethod: "Start type", summaryRunners: "Runners", summaryTimes: "First–last start",
  summaryRunnersValue: (runners, vacant) => `${runners}${vacant > 0 ? ` + ${vacant} vacant` : ""}`,
  vacant: "Vacant",
  time: "Start", name: "Name", club: "Club", card: "Card", none: "–",
  freeStart: "Free start: the runners punch start. The class gets no start times.",
  massStart: time => `Mass start ${time}: everyone in the class starts together.`,
  minuteStart: (time, interval, vacancies) =>
    `First start ${time}, ${interval} min between the starts${vacancies === 1 ? ", 1 vacant time" : vacancies > 1 ? `, ${vacancies} vacant times` : ""}.`,
  empty: "No entries.",
  alternating: classNames => `${names(classNames)} have the same first control and start every other minute.`,
  sameFirstControl: (classNames, code) => `${names(classNames)} have the same first control (${code}) and never start the same minute.`,
  replaces: classNames => `${names(classNames)} already have start times. They are replaced by the new draw.`,
  readOut: count => `${count} have read out and get the result recalculated with the new start time.`,
  statusChanges: count => `${count} change status (approved or mispunched) when the result is recalculated.`
};

/** Engelska, arbetsytan del 4: startlistans publicering. */
export const startListPublicationEn: Texts<typeof startListPublicationSv> = {
  publicTitle: "Start list",
  loadError: "Could not read the publication. Try again.", error: "The start list could not be published. Try again.",
  publish: "Publish the start list", withdraw: "Unpublish",
  published: "The start list is published.", withdrawn: "The start list is unpublished.",
  conflict: "The event has changed in the meantime, or the same list is already published. Try again.",
  publicLink: "Show public start list",
  empty: "An empty participant list cannot be published.",
  invalidContent: "The start list cannot be published right now. An already published list can still be unpublished.",
  publicUnavailable: "No start list can be shown right now. The list may be unpublished, withdrawn or temporarily unavailable.",
  publicLoading: "Fetching the start list…",
  publicHelp: "Planned start, not confirmation of the actual start. The list updates automatically every five seconds.",
  publicRefreshFailed: "The start list could not be refreshed. The latest fetched list is shown.",
  publicVariantsHidden: "The variant letter is shown once the runner has started.",
  publishedAt: "Published",
  publicLive: "Updated continuously",
  live: "Update the start list continuously",
  liveHelp: "On: visitors see changes directly (new entries, start times, classes and card) without a new publication. Off: visitors see the latest published list.",
  statusLive: "Updated continuously. Visitors see changes directly.",
  liveOn: "The start list is updated continuously.",
  liveOff: "The start list is no longer updated continuously. Visitors see the latest published list; publish again to show the current state.",
  liveFailed: "The setting could not be saved. Try again.",
  heading: "Publish the start list",
  listHeading: "The start list",
  listHelp: "The start list as it looks now, by class, start time or club. Print or export it here.",
  shortHelp: cards => (cards ? "The public start list shows name, club, class, start time and card. "
    : "The public start list shows name, club, class and start time, not card. ") +
    "Changes, also a changed card, only show when you publish again. Visitors see it only when the event is also published.",
  loading: "Loading the publication…",
  statusNone: "The start list is not published.",
  statusPublished: time => `Published at ${time}. The public list is current.`,
  statusWithdrawn: time => `Unpublished at ${time}.`,
  statusChanged: time => `Published at ${time}, but the start list has changed since then. Publish again to show the changes.`,
  exportDownloading: "Fetching the start list…",
  exportDownloaded: "The start list is downloaded as IOF XML.",
  exportEmpty: "There is no start list to download yet.",
  exportError: "No start list was downloaded. Check the connection and try again."
};

/** Engelska, arbetsytan del 4: kvar i skogen för målpersonalen. */
export const forestWatchEn: Texts<typeof forestWatchSv> = {
  ageSort: "Sort started without return by reported time",
  ageSortHelp: "Started without return: unknown time first for follow-up, then the longest reported time. The conflict group stays at the top. This is not a risk classification.",
  reportedStartAge: "Since reported start, at the report time (not running time)",
  unknownStartAge: "Unknown time",
  minutes: "min",
  history: "Journal",
  choose: "Choose",
  chooseFor: name => `Choose ${name}`,
  reviewConflict: "Review conflict",
  title: "Still out – finish staff",
  back: "To the event overview",
  help: "Private list for follow-up. A registered return does not mean an approved result.",
  uncertainty: "Only the latest synced information. Offline units can have new marks missing here. The list does not show actual position and does not guarantee that the forest is empty.",
  refresh: "Refresh list", print: "Print the list",
  loadError: "The list could not be refreshed. Check the connection and try again.",
  stale: "WARNING: The list is not refreshed and may be old.",
  private: "PRIVATE – dated list for finish staff. Store and destroy the printout securely.",
  generated: "Updated",
  raceClass: "Class filter", allClasses: "All classes", shown: "Shown participants", total: "the whole race",
  search: "Search name, club or card number", clearFilters: "Clear filters",
  searchFilter: "Search filter", noSearch: "No search", visibleSelection: "Shown selection",
  filteredWarning: "A filter is active. Participants outside the selection are not shown; the group totals always apply to the whole race.",
  noMatchesWarning: "No participants in the selection. That does not mean the forest is empty. Check the whole race's groups and unit details below.",
  groups: { CONFLICT: "Conflicting information – check", STARTED_NO_RETURN: "Started – no registered return",
    UNCONFIRMED: "Unknown start status – follow up", NOT_STARTED: "Did not start according to registered information", RETURNED: "Registered return" },
  name: "Name / club", status: "Information and source", start: "Planned start", card: "Card", noCard: "No active card",
  multipleCards: "Several active cards – check", noOrganisation: "Club missing", punch: rule.rules.PUNCH, missingTime: "Start time missing",
  reports: { UNMARKED: "Start: unmarked / unknown", STARTED: "Start: manually reported", REPORTED_NOT_STARTED: "Start: explicitly reported did not start" },
  manualReturn: "Return: manually registered", readoutReturn: "Return: linked readout / technical source",
  noReturn: "No return registered", activeDns: "Active did-not-start result (DNS)", conflict: "Conflict report or contradiction needs review",
  devices: "Units – latest durable receipt", noDevices: "No registered check-in units. That does not prove that all participants are back.",
  noReceipt: "No operation received", sequence: "Latest received sequence", startDevice: "Start staff", finishDevice: "Finish staff",
  deviceWarning: "The receipt time is not a current contact check. The units' unsynced queues are unknown to the server.",
  online: "The browser reports a network connection – server contact is verified when fetching.", offline: "The browser reports that the network connection is missing.",
  readOnly: "The list can only be read. Reviewing conflicting information needs a network."
};

/** Engelska, arbetsytan del 5: Eventor, löpardatabasen, banfilen och granskningen av skillnader. */
export const sourcesEn: Texts<typeof sourcesSv> = {
  eventor: {
    title: "Eventor",
    help: "Fetch classes and entries with card from Eventor. You can import again when the entries change.",
    serverMissing: "Eventor is not switched on on this server. Whoever runs O-Tid needs to switch it on (see the operations guide).",
    serverInvalid: "Eventor is set up wrongly on this server. Whoever runs O-Tid needs to correct it (see the operations guide).",
    keyLabel: "The club's API key",
    keyHelp: "Found in Eventor under Club → Club settings (only the club's administrators in Eventor can reach it). The key is stored encrypted and never shown again.",
    saveKey: "Save key",
    keySaved: "Key saved",
    keyUnreadable: "The saved key cannot be read because the server's master key has changed. Save the club's key again.",
    replaceKey: "Replace key",
    removeKey: "Remove key",
    cancel: "Cancel",
    test: "Test the connection",
    connectedAs: club => `Connected as ${club}`,
    outcome: {
      CONNECTED: "The connection works.",
      REJECTED: "Eventor did not accept the key. Check that the whole key came along.",
      UNAVAILABLE: "Eventor is not answering right now. Try again in a while.",
      NOT_CONFIGURED: "Eventor is not switched on on the server (see the operations guide).",
      NO_KEY: "Save the club's API key first.",
      KEY_UNREADABLE: "The saved key cannot be read. Save the club's key again."
    },
    eventTitle: "Event in Eventor",
    noEvent: "No event chosen.",
    showEvents: "Show the club's events",
    eventsEmpty: "The club has no events in Eventor in the last year or next year.",
    chooseEvent: "Choose event",
    choose: "Choose",
    pasteLabel: "Or paste the event's number in Eventor",
    pasteHelp: "The number is in the event's address, e.g. eventor.orientering.se/Events/Show/47110.",
    changeEvent: "Change event",
    eventNotFound: "The event does not exist in Eventor. Check the number.",
    eventForm: { INDIVIDUAL: "individual", RELAY: "relay", OTHER: "other form" },
    eventLine: (name, date, form, id) => `${name} · ${date} · ${form} · number ${id}`,
    fetch: "Fetch from Eventor",
    update: "Update from Eventor",
    fetching: "Fetching from Eventor …",
    lastUpdated: when => `Last updated from Eventor ${when}`,
    neverUpdated: "Nothing has been fetched from Eventor yet.",
    problem: {
      NOT_CONFIGURED: "Eventor is not switched on on the server (see the operations guide).",
      NO_KEY: "Save the club's API key first.",
      KEY_UNREADABLE: "The saved key cannot be read. Save the club's key again.",
      NO_EVENT: "Choose the event in Eventor first.",
      REJECTED: "Eventor did not accept the key.",
      UNAVAILABLE: "Eventor is not answering right now. Try again in a while.",
      NOT_FOUND: "The event no longer exists in Eventor."
    },
    failed: "Could not reach the server. Try again.",
    retry: "Try again"
  },
  runnerDatabase: {
    title: "Runner database",
    help: "The club's runners with card and Eventor's clubs. Gives suggestions for an unknown card in readout (also without a network) and in New participant. " +
      "Only administrators and officials see it, never publicly.",
    needsClub: "Test the connection to Eventor first, so that the club is known.",
    empty: "No runner database fetched yet.",
    summary: (when, runners, cards, clubs, wholeCountry) =>
      `Updated ${when} · ${runners} runners · ${cards} cards · ${clubs} clubs${wholeCountry ? " · all of Sweden" : ""}`,
    offline: (count, club, extra, truncated) => `Without a network in readout: ${count} runners from ${club}` +
      `${extra > 0 ? ` and ${plural(extra, "more club", "more clubs")}` : ""}${truncated ? " (there are more, they are searched when there is a network)" : ""}.`,
    wholeCountryOnline: "Other runners in all of Sweden are searched on the server when there is a network.",
    extraTitle: "More clubs in readout",
    extraHelp: "Clubs whose runners should also be available without a network, e.g. neighbouring clubs. Applies from the next update.",
    extraLabel: "Add club",
    addClub: "Add",
    removeClub: name => `Remove ${name}`,
    unknownClub: "Choose a club from the list.",
    wholeCountry: "Include all of Sweden (large fetch)",
    wholeCountryHelp: "Can take several minutes. The whole country is searched on the server; without a network only the clubs above are available.",
    refresh: "Update the runner database from Eventor",
    refreshing: "Fetching runners from Eventor …",
    remove: "Delete the runner database",
    removeConfirm: "Delete the runner database? The runners and clubs are removed from the server. Entries and readouts are not affected.",
    removeYes: "Yes, delete",
    removed: "The runner database is deleted.",
    outcome: {
      REFRESHED: "The runner database is updated.",
      NO_ORGANISATION: "Test the connection to Eventor first, so that the club is known.",
      NOT_CONFIGURED: "Eventor is not switched on on the server (see the operations guide).",
      NO_KEY: "Save the club's API key first.",
      KEY_UNREADABLE: "The saved key cannot be read. Save the club's key again.",
      REJECTED: "Eventor did not accept the key.",
      UNAVAILABLE: "Eventor is not answering right now, or answered with something that could not be read. Try again in a while.",
      TOO_LARGE: "The answer from Eventor was too large. Fetch only the clubs, without all of Sweden."
    },
    failed: "Could not reach the server. Try again."
  },
  courseFile: {
    title: "Course file",
    help: "Import courses, forkings and which classes run which course from OCAD, Purple Pen or Condes (IOF XML 3.0).",
    fileLabel: "Course file (IOF XML)",
    fileHelp: "Export the courses as IOF XML 3.0 (CourseData) from the course setting program.",
    read: "Import course file",
    readAgain: "Import new course file",
    reading: "Reading the course file …",
    lastRead: (file, when) => `Last imported: ${file} ${when}`,
    chooseFile: "Choose a file first.",
    invalid: "The file is not a course file in IOF XML 3.0 (CourseData). Export the courses again and try again.",
    tooLarge: "The file is too large.",
    failed: "Could not reach the server. Try again."
  },
  review: {
    title: source => `Differences from ${source}`,
    summary: counts => [
      counts.new > 0 ? `${counts.new} new` : "", counts.changed > 0 ? `${counts.changed} changed` : "",
      counts.withdrawn > 0 ? `${counts.withdrawn} withdrawn` : "", counts.conflicts > 0 ? `${counts.conflicts} to resolve yourself` : "",
      `${counts.unchanged} unchanged`].filter(Boolean).join(" · "),
    nothing: "Nothing has changed since last time. Nothing to approve.",
    groups: { NEW: "New", CHANGED: "Changed", WITHDRAWN: "Withdrawn", CONFLICT: "To resolve yourself" },
    kindSymbol: { NEW: "+", CHANGED: "~", WITHDRAWN: "−", CONFLICT: "!" },
    subject: { CLASS: "Class", ENTRY: "Participant", TEAM: "Team", COURSE: "Course", CONTROL: "Control" },
    field: { NAME: "Name", CLUB: "Club", CLASS: "Class", CARD: "Card", COURSE: "Course", CONTROLS: "Controls", VARIANTS: "Variant",
      LENGTH: "Length", CLIMB: "Climb", TEAM_NAME: "Team name", CLASS_NAME: "Class name", LEGS: "Leg", POINTS: "Points" },
    none: "–",
    becomes: "becomes",
    withdrawnHelp: "Becomes did not start. The participant and the history stay.",
    legs: count => `${count} legs`,
    matchedByName: "matched by name",
    readOut: "has read out",
    always: "Always created",
    include: label => `Include ${label}`,
    note: {
      WITHDRAWN_READ_OUT: "Withdrawn in the source but has already read out. The result is kept; change the status in the participant card if the runner should be withdrawn.",
      WITHDRAWN_HAS_RESULT: "Withdrawn in the source but already has a result. Change the status in the participant card if needed.",
      CARD_IN_USE: "The card is already used by another participant. Change card in the participant card and import again.",
      CARD_AFTER_READOUT: "Has read out with the old card; the result is kept.",
      TEAM_CLASS_CHANGED: "The team has changed class in Eventor. Move the team under Teams.",
      RELAY_CLASS_MISMATCH: "The class is a relay in one source but not in the other. Change the class and import again.",
      CLASS_CANCELLED: "The class is cancelled in Eventor. The class and its participants stay here.",
      NOT_IN_FILE: "The course is not in the new file. It is not removed; change or remove it yourself if it should not be used.",
      COURSE_IN_USE: "The course is used by classes here."
    },
    consequenceTitle: "How the results are affected",
    noResults: "None of the changes affect results.",
    cardsKept: count => count === 1 ? "1 runner has read out and gets a new card. The result is kept." : `${count} runners have read out and get a new card. The results are kept.`,
    apply: count => count === 1 ? "Approve 1 change" : `Approve ${count} changes`,
    applyAndRecalculate: count => count === 1 ? "Approve 1 change and recalculate" : `Approve ${count} changes and recalculate`,
    cancel: "Cancel",
    stale: "Something has changed in the meantime. Import the source again.",
    consequenceChanged: "The message has changed. Review the new message and approve again.",
    applied: (count, recalculated) => `${plural(count, "change", "changes")} saved` +
      (recalculated > 0 ? `, ${plural(recalculated, "result has", "results have")} been recalculated.` : "."),
    failed: "The changes could not be saved. Try again."
  }
};

/** Engelska, arbetsytan del 6: ta bort och stryk. */
export const removalEn: Texts<typeof removalSv> = {
  entryHeading: "Remove or withdraw",
  entryDelete: "Remove participant",
  entryStrike: "Withdraw",
  entryDeleteHelp: "The participant has not read out and can be removed completely.",
  entryStrikeHelp: "The participant has read out or has a result. Withdraw hides the participant in all lists but keeps the readout and the history.",
  entryDeleteConsequence: name => `${name} is removed from the event. The card and a drawn start time become free. It cannot be undone.`,
  entryStrikeConsequence: name =>
    `${name} is withdrawn and no longer shows in any list, not publicly either. The readout and the history are kept and the card becomes free.`,
  entryAnonymize: "Anonymise",
  entryAnonymizeHelp: "Anonymise removes name, club, card and Eventor's id from the event, the journal and the saved files. " +
    "The result and the split times stay as “Anonymous participant”.",
  entryAnonymizeConsequence: name => `${name} becomes “Anonymous participant”. Name, club, card and Eventor's id are removed from ` +
    "the entry, the journal, the start and result lists and the imported files; the GPS route is removed. The result and the split times stay. " +
    "It cannot be undone.",
  confirmAnonymize: "Anonymise the participant",
  entryAnonymized: "The participant is anonymised.",
  confirmDelete: "Remove", confirmStrike: "Withdraw the participant", cancel: "Cancel", retry: "Try again",
  entryDeleted: name => `${name} is removed.`,
  entryStruck: name => `${name} is withdrawn.`,
  classDelete: "Remove class",
  classDeleteLabel: name => `Remove the class ${name}`,
  classDeleteConsequence: name => `The class ${name} is removed. It cannot be undone.`,
  classDeleted: name => `The class ${name} is removed.`,
  courseDelete: "Remove course",
  courseDeleteLabel: name => `Remove the course ${name}`,
  courseDeleteConsequence: name => `The course ${name} is removed. The controls stay. It cannot be undone.`,
  courseDeleted: name => `The course ${name} is removed.`,
  blocked: (blocker, detail) => {
    switch (blocker) {
      case "HAS_RESULT": return "The participant has a result and cannot be removed. Withdraw the participant instead.";
      case "RELAY_RUNNER": return "Leg runners are not removed here. Change leg runner under Teams.";
      case "CLASS_HAS_ENTRIES": return `The class has ${plural(detail.count ?? 0, "entry", "entries")}. Move them to another class or remove them first.`;
      case "CLASS_HAS_HISTORY": return "The class has withdrawn participants or teams with history and cannot be removed.";
      case "COURSE_USED_BY_CLASS": return `The course is used by ${names(detail.names ?? [])}. Change course on ${(detail.names?.length ?? 0) === 1 ? "the class" : "the classes"} first.`;
      case "COURSE_HAS_RESULTS": return "There are results assessed against the course, so it cannot be removed.";
    }
  },
  changed: "The participant has changed since you opened the card. Load again and try again.",
  error: "Could not remove. Try again.",
  unreachable: "Could not reach the server. Try again."
};

/** Engelska, arbetsytan del 6: Resultaten är klara. */
export const resultsOfficialEn: Texts<typeof resultsOfficialSv> = {
  title: "The results are ready",
  help: "When everyone has finished and the results are right: press the button. The lists are marked Official results and you get the IOF file to upload to Eventor. It can be undone.",
  mark: "The results are ready",
  markAgain: "The results are ready again",
  undo: "Make the results preliminary again",
  download: "Download IOF file for Eventor",
  official: when => `Official results since ${when}.`,
  changed: when => `The results have changed since they were ready ${when}. The lists show as preliminary until you press the button again.`,
  preliminary: "The lists show as Preliminary results.",
  markedOfficial: "The results are ready. The lists show Official results.",
  markedPreliminary: "The results are preliminary again.",
  blockedTitle: "This must be sorted out first:",
  blockedClass: (className, reasons) => `${className}: ${reasons}`,
  missingResults: "Some have no result. Read them out, or mark them as did not start under Follow-up.",
  entryIssue: (className, name, what) => `${className}: ${name} ${what}`,
  entryIssues: {
    MISSING_RESULT_REVISION: "has no result and may still be out. Read out the card, or set Did not start or Did not finish in the participant card.",
    WITHDRAWN_DID_NOT_START: "has no result since the decision was removed. Read out the card or make a new decision in the participant card.",
    LATEST_RESULT_UNPUBLISHED: "has a result that is not published. Recalculate from the readout in the participant card.",
    INVALID_RESULT_REVISION: "has a result that cannot be checked against the course. Choose variant or recalculate from the readout in the participant card.",
    RESULT_CLASS_MISMATCH: "has a result based on another class. Recalculate from the readout in the participant card.",
    RESULT_COURSE_MISMATCH: "has a result based on an older course. Recalculate from the readout in the participant card.",
    STALE_RESULT_SNAPSHOT: "has a result based on an older course or class. Recalculate from the readout in the participant card."
  },
  unconfirmedMispunched: count => `${plural(count, "mispunch is", "mispunches are")} not confirmed. That does not stop the results from being ready.`,
  openEntry: "Open",
  openEntryFor: name => `Open the participant card for ${name}`,
  unknownCards: "There are unknown cards that are not handled. Link them to a participant or enter directly under Readout → Unknown cards.",
  loading: "Loading …",
  loadError: "The state could not be loaded.",
  conflict: "The results changed while you pressed. Try again.",
  unreachable: "Could not reach the server. Try again.",
  retry: "Try again",
  downloaded: "The IOF file is downloaded.",
  downloadError: "The IOF file could not be downloaded. Try again.",
  advanced: "Advanced: make one class official at a time",
  advancedHelp: "Rarely needed. Make a finished class official while other classes are ongoing. The results are ready does it for all classes."
};

/** Engelska, arbetsytan del 6: Ny tävling som den här. */
export const raceCopyEn: Texts<typeof raceCopySv> = {
  action: "Copy",
  actionLabel: raceName => `Copy ${raceName} to a new event`,
  settingsTitle: "New event like this one",
  settingsHelp: "Makes recurring trainings quick: the same courses, classes and settings, but without participants and results.",
  settingsAction: "New event like this one …",
  title: "New event like …",
  intro: name => `Creates a new event with the same courses, classes and settings as ${name}.`,
  eventName: "Event name",
  raceName: "Stage/race",
  raceDate: "Date",
  includePeople: "Include officials and administrators (also the course setting people)",
  includePeopleHelp: "You become owner. Other administrators (also the current owner) become administrators, officials become officials. Course setting access (helpers, controller, mapper) and the notes come along.",
  includePeopleOff: "Only you get access to the new event. Course setting access and notes do not come along.",
  copiedTitle: "Comes along",
  copiedList: "Courses with controls and forkings, classes with start type and maximum, the relay legs, rogaining points, " +
    "map with georeference and radio controls (switched off until you switch them on).",
  notCopiedTitle: "Does not come along",
  notCopiedList: "Participants and teams, start times and draw, readouts, results, routes, the Eventor link and the publication. " +
    "The new event is unpublished and gets its own short address.",
  submit: "Create the copy",
  copying: "Copying …",
  cancel: "Cancel",
  close: "Close",
  created: "The copy is created.",
  summary: copied => [
    plural(copied.courses, "course", "courses"),
    plural(copied.classes, "class", "classes"),
    plural(copied.controls, "control", "controls"),
    ...(copied.people > 0 ? [`${plural(copied.people, "person", "people")} with access`] : []),
    ...(copied.map ? ["map"] : [])
  ].join(" · "),
  eventorNote: "The source was linked to Eventor. Choose an Eventor event for the copy under Settings if the entries should be fetched from there.",
  radioNote: "The radio controls are switched off in the copy. Switch them on under Settings before the event.",
  open: "Open the copy",
  opening: "Opening …",
  errors: {
    forbidden: "Only owners and administrators can copy the event.",
    notFound: "The event no longer exists, or you do not have access to it.",
    invalid: "Check the names (at least two characters) and the date.",
    session: "The sign-in has expired. Sign in again and try once more.",
    conflict: "The request clashed with an earlier copy. Close and try again.",
    network: "No contact with the server. Try again – the same attempt does not create two copies.",
    generic: status => `The copy failed (${status}). Try again – the same attempt does not create two copies.`
  }
};

/** Engelska, arbetsytan del 6: gafflingarna (varianter, fördelning och kontroll före start). */
export const courseVariantsEn: Texts<typeof courseVariantsSv> = {
  forked: count => count === 1 ? "Forked (1 variant)" : `Forked (${count} variants)`,
  showVariants: count => count === 1 ? "Show the variant" : `Show ${count} variants`,
  variant: "Variant",
  variantColumn: "Variant",
  variantControls: "Controls",
  variantRunners: "Entries",
  variantReadOut: "Read out",
  editVariant: "Edit",
  editVariantLabel: (course, code) => `Edit variant ${code} on ${course}`,
  editingVariant: code => `Variant ${code}`,
  variantSummaryNote: "The message applies to the runners on the variant. Everyone read out on the course is recalculated when you save.",
  distribute: "Distribute forkings",
  distributeLabel: className => `Distribute forkings in ${className}`,
  missingVariants: count => `${count} missing a variant`,
  distributed: count => `${plural(count, "runner", "runners")} got a variant.`,
  distributeError: "The forkings could not be distributed. Try again.",
  distributeConflict: "The event has changed in the meantime. The classes are loaded again; try once more.",
  noVariant: "No variant – assessed against the variant the punches fit",
  chooseVariant: "Change variant",
  variantChanged: code => `The variant is changed to ${code}.`,
  variantChangedRecalculated: code => `The variant is changed to ${code}. The result was recalculated.`,
  variantConfirmTitle: "The result changes",
  variantConfirm: "Change variant",
  variantCancel: "Cancel",
  variantResultChange: (name, before, after) => `${name}: ${before} → ${after}`,
  variantError: "The variant could not be changed. Try again.",
  variantConflict: "The event has changed in the meantime. The participant is loaded again; choose variant once more.",
  readinessOk: variants => `Ready for the start: all ${variants} variants have runners and the distribution is even.`,
  readinessOkUnused: unused => `Ready for the start. Fewer runners than variants, so ${unused.join(", ")} are not used.`,
  readinessLabel: "Before the start",
  readinessUnused: unused => unused.length === 1 ? `Variant ${unused[0]} has no runners`
    : `The variants ${unused.slice(0, 8).join(", ")}${unused.length > 8 ? " …" : ""} have no runners`,
  readinessMissing: (className, count) => count === 1 ? `1 runner in ${className} is missing a variant`
    : `${count} runners in ${className} are missing a variant`,
  readinessUneven: (className, point, counts) => `${className}, forking ${point}: ${counts.map(row => `${row.letters} ${row.count}`).join(", ")}`,
  readinessTooMany: count => `${count} variants – at most 100 work`,
  readinessLetters: "More than 26 forking letters",
  wrongMap: (assigned, fitting) => `Mispunched against ${assigned}, but the punches fit ${fitting.join(" and ")}. Did the runner get the wrong map?`,
  wrongMapShort: fitting => `Wrong map? Fits ${fitting.join(", ")}`,
  excludedVariant: codes =>
    `The punches fit ${codes.join(" and ")}, which is excluded in course setting. Did the runner get the wrong map? Correct status or variant by hand.`,
  excludedVariantShort: codes => `Excluded variant? Fits ${codes.join(", ")}`,
  readinessExcluded: count => `${plural(count, "variant", "variants")} excluded in course setting`,
  approveOn: code => `Approve on ${code}`,
  approveOnHelp: "Changes the runner's variant and recalculates the result. The reason is saved in the history.",
  variantShort: code => `Variant ${code}`,
  variantGuessed: code => `Variant ${code} (from the punches)`,
  importVariants: (variants, persons) => `${variants} variants${persons === undefined ? "" : `, ${plural(persons, "runner", "runners")} got their variant`}`
};
