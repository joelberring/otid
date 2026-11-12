import { nameList } from "./plural";
import type { Texts } from "../lib/language";
import type { clubArchiveSv } from "./club-archive-sv";

/** Engelska del 34: klubbytan och klubbarkivet (träningar, kartor, medlemmar, importen, Använd igen). */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const mb = (bytes: number) => bytes > 0 && bytes < 100 * 1024
  ? `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("en-GB")} kB`
  : `${(bytes / 1024 / 1024).toLocaleString("en-GB", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} MB`;

export const clubArchiveEn: Texts<typeof clubArchiveSv> = {
  mb,
  title: "Club archive",
  myClubs: {
    title: "My clubs",
    hint: "The club's archive with maps and courses from earlier trainings, to use them again. Only for invited people.",
    empty: "You are not in any club yet.",
    create: "New club space",
    name: "The club's name",
    namePlaceholder: "e.g. OK Älvsjö-Örby",
    nameMissing: "Write the club's name.",
    nameTooLong: (max: number) => `The name can be at most ${max} characters.`,
    nameTaken: "You already have a club with that name. Open it in the list above or choose another name.",
    createButton: "Create the club",
    open: "Open the archive",
    entries: (n: number) => count(n, "training", "trainings"),
    failed: "The club could not be created. Try again."
  },
  roles: { OWNER: "Owner", ADMIN: "Administrator", LEADER: "Leader", READER: "Member" },
  roleHelp: {
    OWNER: "everything, including the owners",
    ADMIN: "everything in the club space: changes the archive, invites, confirms and imports",
    LEADER: "sees the training archive and uses the map bank (map files, Use again)",
    READER: "sees what the club lets members see under Who sees what"
  },
  tabs: { trainings: "Trainings", planning: "Planning", maps: "Maps", members: "Members", devices: "Units", club: "The club", import: "Import" },
  back: "My events",
  backToArchive: "The club archive",
  loading: "Fetching the archive …",
  loadFailed: "The archive could not be fetched. Are you signed in and a member of the club?",
  usage: (bytes: number, maps: number, versions: number, entries: number) =>
    `${mb(bytes)} · ${count(maps, "map", "maps")} (${count(versions, "version", "versions")}) · ${count(entries, "training", "trainings")}`,
  filters: {
    search: "Search",
    searchPlaceholder: "Place, exercise, course …",
    year: "Year",
    map: "Map",
    tag: "Own words",
    leader: "Leader",
    status: "Show",
    all: "All",
    clear: "Clear",
    count: (shown: number, total: number) => shown === total ? count(total, "training", "trainings") : `${shown} of ${total} trainings`,
    none: "No trainings match."
  },
  status: {
    COMPLETE: "Map and courses",
    COURSES_ONLY: "Courses, the map from another training",
    MAP_MISSING: "Map missing",
    MAP_ONLY: "Only map"
  },
  empty: {
    title: "The archive is empty",
    admin: "Import the club's trainings from your computer under Import, or upload a map under Maps.",
    reader: "Nobody has imported anything yet."
  },
  entry: {
    mapBankClosed: "The map files and Use again are for the club's leaders and administrators (the club's choice under Who sees what).",
    fromRace: "From the event",
    readOnlyHint: "The archive shows the training as it was done. To change the courses: Use again – then a copy opens in course setting.",
    courses: "Courses",
    noCourses: "No course files in this training.",
    courseCount: (n: number) => count(n, "course", "courses"),
    controls: (n: number) => count(n, "control", "controls"),
    length: (meters: number) => `${(meters / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })} km`,
    mapVersion: "Map version",
    madeWith: "Made on",
    latest: "the latest version",
    olderVersion: "older version",
    resolution: {
      FOLDER: "the map was in the same folder",
      NAME: "the map found in another training",
      MANUAL: "the map chosen by hand",
      MISSING: "map missing",
      NONE: "the file names no map"
    },
    resolutionFromRace: "the map was the competition's",
    chooseMap: "Choose map",
    noMap: "No map",
    saveMap: "Save the map",
    download: "Download original",
    showOnMap: "Show on the map",
    usedHere: "used in the training",
    downloadMap: "Download the map file",
    source: "Source",
    leader: "Leader",
    notes: "Note",
    date: "Date",
    place: "Place",
    titleField: "Title",
    edit: "Change",
    save: "Save",
    cancel: "Cancel",
    saved: "Saved.",
    remove: "Remove from the archive",
    removeConfirm: "Remove the training from the archive? The course files are removed with it; the maps remain.",
    removed: "The training is removed.",
    preview: "The course on the map",
    previewLoading: "Drawing the map …",
    previewFailed: "The map could not be drawn here. Download the original and open it in OCAD or Mapper.",
    previewNoMap: "The course file has no map in the archive.",
    allControls: "All controls",
    rights: "The map's rights",
    problem: "The file could not be read completely:"
  },
  rights: {
    CLUB: "The club's own map",
    EXTERNAL: "External map",
    owner: "Owner",
    agreement: "Agreement",
    validUntil: "Valid until",
    contact: "Contact",
    trainingOnly: "Training only",
    feePerPrint: "Fee per print",
    noPublicDisplay: "No public display",
    none: "No special terms given."
  },
  reuse: {
    open: "Use again",
    title: "Use the training again",
    help: "A new training with the map and the courses. The archive does not change.",
    eventName: "Name",
    date: "Date",
    target: "Where",
    own: "New training (My events)",
    plan: "To the term plan",
    planHelp: "Choose an upcoming week without a training: the copy is linked there and gets the week's title, date and group.",
    planNone: "None (just a new training)",
    planFailed: "The training was created but could not be linked to the plan. Link it from the week in the planning.",
    group: (name: string) => `In the group ${name}`,
    courseFile: "Course file",
    courseFileHelp: "The files have different courses. Choose the course setting to use.",
    courseFileLabel: (fileName: string, courses: readonly string[]) => courses.length > 0 ? `${fileName} (${nameList(courses, "and")})` : fileName,
    mapVersion: "Map version",
    latestDefault: "The latest version is preselected.",
    versionLabel: (fileName: string, date: string | null, latest: boolean) => `${date ?? "no date"} – ${fileName}${latest ? " (latest)" : ""}`,
    start: "Create the training",
    working: {
      race: "Creating the training …",
      group: "Putting it in the group …",
      reading: "Reading the map file …",
      drawing: "Drawing the map …",
      map: "Saving the map …",
      courses: "Importing the courses …",
      transfer: "Transferring the courses to timing …"
    },
    notes: {
      organiser: (club: string) => `The training belongs to ${club} (Settings → The club and the club archive).`,
      organiserFailed: "The organising club could not be set; choose it under Settings → The club and the club archive.",
      transferred: (courses: readonly string[], classes: readonly string[]) => courses.length === 0
        ? "The courses were already in timing."
        : `The courses ${nameList(courses, "and")} have been transferred to timing${classes.length > 0
          ? `, with the ${classes.length === 1 ? "class" : "classes"} ${nameList(classes, "and")}` : ""}.`,
      transferFailed: "The courses are in course setting but could not be transferred to timing. Choose File → Transfer to the event."
    },
    done: "Done! Opening course setting …",
    failed: {
      race: "The training could not be created.",
      group: "The training was created but could not be put in the group. Put it in the group from the training's page.",
      map: "The training was created but the map could not be saved. Upload the map file on the training's page.",
      mapTooLarge: "The training was created, but the map file is larger than 75 MB and cannot be the event's map yet. The courses are there.",
      courses: "The training and the map were created but the courses could not be imported. Import the course file in course setting.",
      courseSetting: "The training, the map and the courses were created, but the courses could not be put on the map in course setting."
    },
    openRace: "Open the training"
  },
  align: {
    title: "Move the courses to the latest map version",
    SAME: "The map versions have the same georeference. The controls keep their positions.",
    GEOREFERENCED: "The map versions have different georeferences in the same coordinate system. The controls are moved via the coordinates so they end up in the same place in the terrain.",
    MANUAL: {
      NO_GEOREFERENCE: "One of the map versions has no georeference, so O-Tid cannot see whether the map has moved. Check the course on the new map and adjust if needed.",
      UNKNOWN_CRS: "At least one of the map versions has an unknown coordinate system, so O-Tid cannot see whether the map has moved. Check the course on the new map and adjust if needed.",
      DIFFERENT_CRS: "The map versions have different coordinate systems. Check the course on the new map and adjust if needed."
    },
    outside: "Some controls end up outside the new map.",
    extentChanged: "The map's extent has changed between the versions.",
    offset: (dx: number, dy: number) => `Offset ${dx.toLocaleString("en-GB")} mm east, ${dy.toLocaleString("en-GB")} mm north`,
    nudge: { up: "North", down: "South", left: "West", right: "East", reset: "Reset" },
    step: "Step",
    accept: "The courses are in the right place",
    preview: "The course on the new map version",
    checking: "Comparing the map versions …",
    courseDataNote: "CourseData files are not moved; the controls' positions follow the file."
  },
  maps: {
    title: "Maps",
    help: "A map is an area with versions. Old trainings show the version they were made on; Use again chooses the latest.",
    empty: "No maps yet.",
    versions: (n: number) => count(n, "version", "versions"),
    trainings: (n: number) => count(n, "training", "trainings"),
    latest: "latest",
    rename: "Name and rights",
    move: "Move the version to …",
    moveNew: "New map …",
    newMapName: "The new map's name",
    moveButton: "Move",
    upload: "Upload new version",
    uploadNew: "New map",
    uploadHelp: "OCAD (.ocd) or Mapper (.omap, .xmap), at most 75 MB. The new version becomes the latest.",
    file: "Map file",
    versionDate: "The version's date",
    note: "Note",
    mapName: "The map's name",
    uploadButton: "Upload",
    uploading: "Uploading …",
    uploaded: "The new version is saved.",
    duplicate: "That file is already in the archive.",
    tooLarge: "The map file is larger than 75 MB.",
    invalid: "The file does not look like an OCAD or Mapper map.",
    quota: (used: number, limit: number) => `The storage is full (${used} of ${limit} MB). Remove old maps or ask the server's owner to raise the limit.`,
    toGroup: "Put in the group's map library",
    toGroupHelp: "The latest version is drawn and put in the group's map library with the map's rights. If the map is already there it is replaced by the latest version.",
    toGroupButton: (name: string) => `Put in ${name}`,
    toGroupDone: (updated: boolean) => updated ? "The group's map is updated to the latest version." : "The map is now in the group's map library.",
  },
  members: {
    title: "Access in the club space",
    help: "Who is a member, leader, administrator or owner here in the club space. The club's members according to Eventor and those confirmed by hand are under The club. Invite with one or more email addresses. With email on the server, each person gets an email with a link. The person becomes a member when they sign in with the address and have confirmed it.",
    readerHelp: "The member list is shown to the club's owners and administrators. Your own role is shown here.",
    invite: "Invite",
    email: "Email address",
    role: "Role",
    inviteButton: "Invite",
    invited: "The invitation is saved. It applies when the person signs in with the address.",
    pending: "waiting for sign-in",
    remove: "Remove",
    removeConfirm: (who: string) => `Remove ${who} from the club?`,
    exists: "The address is already in the list.",
    lastOwner: "The club must have at least one owner.",
    changeRole: "Change role",
    you: "you"
  },
  importer: {
    help: "The import runs on your computer and sends the map files and course files directly to this server. PDF, Word, Excel, images and other files are never read and never sent.",
    usageTitle: "The archive's size",
    quota: (used: number, limit: number | null) => limit === null ? `Your uploaded maps: ${mb(used)} (no limit).`
      : `Your uploaded maps: ${mb(used)} of ${mb(limit)}.`,
    step1: "1. Get O-Tid onto the computer (git clone) and run pnpm install once.",
    step2: "2. Test run: nothing is sent, the report shows what would be imported.",
    step3: "3. Create an import key here and run the import. The key is valid for 12 hours and is only shown once.",
    step4: "4. Did something go wrong? Run the same command again; what already exists is skipped.",
    tokenPrompt: "The command asks for the import key; paste it (it does not show when you paste). The key belongs to this club, so the club need not be given.",
    createToken: "Create import key",
    tokenShown: "The import key (copy it now, it is not shown again):",
    copy: "Copy",
    copied: "Copied.",
    tokens: "Import keys",
    tokenState: (created: string, expires: string, revoked: boolean, used: string | null) =>
      `${created} · ${revoked ? "revoked" : `valid until ${expires}`}${used ? ` · last used ${used}` : ""}`,
    revoke: "Revoke",
    leaders: "The leaders' names in [square brackets] are personal data. Add the flag below if they should not be included:",
    leadersFlag: "--utan-ledare"
  },
  errors: {
    session: "You are no longer signed in. Sign in again.",
    invalid: "Something in the form is wrong.",
    notFound: "Does not exist, or you do not have access.",
    forbidden: "Your role in the club is not enough for that.",
    conflict: "That did not work: something has changed or already exists.",
    generic: (status: number) => `That did not work (error ${status}). Try again.`
  }
};
