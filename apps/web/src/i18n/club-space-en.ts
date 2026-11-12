import type { ClubMapVersionYearSource } from "@o-tid/contracts";
import type { Texts } from "../lib/language";
import type { clubAffiliationSv } from "./club-affiliation-sv";
import type { clubMapDuplicatesSv } from "./club-map-duplicates-sv";
import type { clubStartSv } from "./club-start-sv";
import { clubAffiliationAccountEn } from "./account-en";
import { clubRaceEn } from "./workspace-last-en";

/** Engelska del 34: klubbytan (Eventor, Vem ser vad, medlemmar), Från klubben, Kom igång och kartornas dubbletter och versioner. */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const percent = (value: number) => `${Math.round(value * 100)} %`;
const versionsText = (n: number) => count(n, "version", "versions");
const km = (meters: number) => (Math.round(meters / 100) / 10).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const EVENTOR_KEY_PLACE_EN = "Club → Club settings";

type Affiliation = typeof clubAffiliationSv;

export const clubSpaceEn: Texts<Affiliation["space"]> = {
  tab: "The club",
  unlinked: "Not linked to Eventor",
  unlinkedHelp: "The club space is not proven with the club's Eventor key. The members then do not know that it is the club's own.",
  linkedBadge: (club: string) => `Linked to Eventor · ${club}`,
  eventorTitle: "Link to Eventor",
  eventorHelp: `Paste the club's API key. It is in Eventor under ${EVENTOR_KEY_PLACE_EN}, and only the club's administrators in Eventor can reach it. O-Tid asks Eventor which club the key belongs to. The key is stored encrypted and never shown again.`,
  key: "The club's API key",
  link: "Link to Eventor",
  linking: "Linking …",
  linked: (club: string, hint: string) => `Linked to Eventor · ${club} · key …${hint}`,
  renameOnLink: "Rename the club space to the club's name in Eventor",
  renamed: (name: string) => `The club space is now called ${name}, like the club in Eventor.`,
  nameDiffers: (space: string, eventor: string) => `The club space is called ${space} but the club in Eventor is called ${eventor}.`,
  renameTo: (name: string) => `Rename to ${name}`,
  replace: "Change key",
  unlink: "Remove the link",
  unlinkConfirm: "Remove the link to Eventor? The key and the member list are removed, and those confirmed via Eventor wait for confirmation again.",
  sync: "Fetch members now",
  syncing: "Fetching …",
  counts: (members: number, confirmed: number) => `${members} members in Eventor, ${confirmed} have O-Tid and are confirmed`,
  syncedAt: (at: string) => `Last fetched ${at}. The list is fetched automatically once a day.`,
  neverSynced: "The member list has not been fetched yet.",
  problems: {
    NOT_CONFIGURED: "The server does not have Eventor turned on (the master key is missing). Contact whoever runs O-Tid.",
    INVALID_KEY: "That does not look like an API key from Eventor (16–128 characters).",
    REJECTED: "Eventor did not accept the key. Check that it is the club's key and not revoked.",
    UNAVAILABLE: "Eventor did not answer. Try again in a while.",
    ALREADY_LINKED: "The club is already linked to another club space in O-Tid. Contact the owner of that club space.",
    TOO_SOON: "The members were fetched just now. Try again in an hour.",
    NOT_LINKED: "The club space is not linked to Eventor."
  },
  accessTitle: "Who sees what",
  accessHelp: "The club decides. Owners and administrators always see and use everything; the maps' own rights apply on top for members and leaders.",
  archive: "The training archive (trainings, thumbnails, course files) is visible to",
  mapBank: "The map bank (map files, Use again, download) may be used by",
  mapBankHint: "Choose Leaders and admins if the maps should not be shared with all members.",
  MEMBERS: "All members",
  LEADERS: "Leaders and admins",
  saveAccess: "Save",
  accessSaved: "Who sees what is saved.",
  pending: (n: number) => `Waiting for confirmation (${n})`,
  pendingHelp: "They chose the club but their address was not in Eventor's member list (or the club space is not linked). Only confirm someone you know is in the club.",
  pendingNone: "Nobody is waiting.",
  freeText: (text: string) => `wrote ”${text}”`,
  confirm: "Confirm",
  decline: "Decline",
  confirmed: (n: number) => `Members of the club (${n})`,
  confirmedHelp: "Confirmed as members of the club, through Eventor or by hand. They have the role Member in the club space; leaders, administrators and owners are set under the Members tab (Access in the club space).",
  confirmedNone: "No confirmed members yet.",
  removeMember: "Remove",
  removeConfirm: (name: string) => `Remove ${name} as a confirmed member?`,
  failed: "That did not work. Try again.",
  archiveClosed: "The training archive is for the club's leaders and administrators (the club's choice under Who sees what)."
};

export const fromClubEn: Texts<Affiliation["fromClub"]> = {
  title: "From the club",
  help: "Confirmed members of your clubs who have O-Tid. You only see the names; the invitation is sent to their address.",
  search: "Search name",
  none: "No confirmed members to invite.",
  already: "already a member",
  invite: (n: number) => n === 1 ? "Invite 1 person" : `Invite ${n} people`,
  invited: (n: number, already: number) => `${count(n, "invitation", "invitations")} saved.${already > 0 ? ` ${already} ${already === 1 ? "was" : "were"} already members.` : ""}`,
  failed: "The invitations could not be saved. Try again.",
  open: "From the club",
};

/** Hela `clubAffiliationSv` på engelska (delarna står där de först översattes). */
export const clubAffiliationEn: Texts<Affiliation> = {
  ...clubAffiliationAccountEn,
  space: clubSpaceEn,
  fromClub: fromClubEn,
  race: clubRaceEn
};

export const clubMapDuplicatesEn: Texts<typeof clubMapDuplicatesSv> = {
  duplicates: {
    title: "Possible duplicates",
    heading: (n: number) => `Possible duplicates (${n})`,
    help: "Maps that are probably the same map under different names. Merge them into one map with the versions in year order. Nothing is merged by itself.",
    level: { HIGH: "Probably the same map", MEDIUM: "Maybe the same" },
    reasons: {
      area: (overlap: number, contained: number) => overlap >= 0.5 || contained < overlap ? `Same area (${percent(overlap)} overlap)`
        : `Covers the same area (${percent(contained)} of the smaller map)`,
      SAME_NAME: "Same name",
      SIMILAR_NAME: "Similar name",
      SAME_EXTENT: "Same map extent",
      SAME_SYMBOLS: "Same symbols",
      SIMILAR_SYMBOLS: "Similar symbols",
      SAME_SCALE: "Same scale",
      trainings: (n: number) => n === 1 ? "Used in the same training" : `Used in the same trainings (${n})`
    },
    unchecked: "Not checked yet: compared on the name and the trainings.",
    keep: "Keep the name and details from",
    include: (name: string) => `Include ${name}`,
    merge: "Merge into one map",
    notSame: "Not the same map",
    mergeHelp: "The versions are moved under the map you keep and ordered by year. The map files and the trainings do not change, and the merge can be undone under ”History”.",
    merged: (name: string, n: number) => `The maps are merged into ${name} (${versionsText(n)} moved).`,
    dismissed: "The maps are not suggested again.",
    loadFailed: "The suggestions could not be fetched.",
    selection: {
      select: (name: string) => `Mark ${name}`,
      merge: "Merge marked",
      count: (n: number) => `${count(n, "map", "maps")} marked`,
      clear: "Unmark",
      title: "Merge marked maps"
    },
    extent: {
      ground: (widthM: number, heightM: number) => `${km(widthM)} × ${km(heightM)} km`,
      paper: (widthMm: number, heightMm: number, scale: number) => `${Math.round(widthMm)} × ${Math.round(heightMm)} mm at 1:${scale.toLocaleString("en-GB")}`,
      none: "No extent yet"
    },
    years: (from: number, to: number) => from === to ? String(from) : `${from}–${to}`
  },
  versions: {
    summary: (n: number, years: { from: number; to: number } | null) => years
      ? `${versionsText(n)}, ${years.from === years.to ? years.from : `${years.from}–${years.to}`}` : versionsText(n),
    yearSource: {
      MANUAL: "entered", FILE_NAME: "guessed from the file name", FOLDER: "guessed from the folder name", YEAR_FOLDER: "guessed from the year folder",
      DATE: "guessed from the version's date", UPLOAD: "guessed from the upload"
    } satisfies Record<ClubMapVersionYearSource, string>,
    edit: "Change year and details",
    editTitle: (fileName: string) => `Year and details: ${fileName}`,
    year: "Year",
    yearHelp: "Leave empty to guess the year again.",
    maker: "Mapper",
    note: "Note",
    save: "Save",
    cancel: "Cancel",
    saved: "The version is saved.",
    copyAll: "Copy to all versions",
    copyAllTitle: (fileName: string) => `Copy from ${fileName} to all versions`,
    fromMap: "From the map",
    fromMapTitle: (fileName: string) => `The mapper from the map to ${fileName}`,
    fields: { maker: "Mapper", note: "Note" },
    preview: "This changes:",
    previewLine: (fileName: string, field: string, before: string | null, after: string | null) =>
      `${fileName}: ${field} ${before ?? "–"} → ${after ?? "–"}`,
    nothing: "Nothing changes: the versions already have the same details.",
    confirm: "Copy",
    copied: (n: number) => n === 1 ? "1 version is changed." : `${n} versions are changed.`,
    makerLabel: (maker: string) => `Mapper: ${maker}`
  },
  mapInfo: {
    title: "Name and description",
    description: "Description",
    maker: "Mapper",
    makerHelp: "Applies to the map. ”Copy to all versions” puts it on the versions.",
    scale: (scale: number) => `1:${scale.toLocaleString("en-GB")}`
  },
  history: {
    title: "History",
    merged: (date: string, names: readonly string[], n: number) => `${date}: ${names.join(", ")} were merged here (${versionsText(n)}).`,
    undo: "Undo merge",
    undone: (date: string) => `Undone ${date}.`,
    locked: "The map has changed since then. Move the versions one by one with ”Move the version to …”.",
    undoDone: "The merge is undone.",
    conflict: "The map has changed since the merge and cannot be split here."
  },
  picker: {
    open: "Choose map from the club archive",
    planned: "The map in the club's term planning",
    close: "Close the club archive",
    help: "The maps in your clubs' archives. The latest version is preselected; the map's rights follow along to the event.",
    none: "There are no maps in your clubs' archives.",
    loading: "Fetching the clubs' maps …",
    loadFailed: "The clubs' maps could not be fetched.",
    search: "Search map",
    version: "Version",
    versionLabel: (year: number, fileName: string, latest: boolean) => `${year} · ${fileName}${latest ? " (latest)" : ""}`,
    club: (name: string) => `Club: ${name}`,
    use: "Use the map",
    useMap: (name: string) => `Use the map ${name}`,
    chosen: (name: string, year: number) => `Chosen map: ${name} (${year})`,
    remove: "No map",
    issues: { EXPIRED: "The agreement has expired", TRAINING_ONLY: "Training only", FEE_PER_PRINT: "Fee per print" },
    trainingOnlyRace: "The map may only be used for training.",
    working: { reading: "Reading the map …", drawing: "Drawing the map …", saving: "Saving the map in the event …" },
    saved: (name: string) => `${name} is the event's map.`,
    failed: "The map could not be saved in the event. Try again or upload the map file.",
    tooLarge: "The map file is larger than the event's limit and cannot be the event's map yet.",
    createLabel: "Map (optional)"
  }
};

export const clubStartEn: Texts<typeof clubStartSv> = {
  title: "Get started",
  freshTitle: (club: string) => `${club} is created`,
  freshNext: "Next step: link the club space to Eventor with the club's API key. It shows that the club space is the club's own, and members in Eventor are confirmed automatically.",
  intro: "A few steps before the club can use the club space. The card disappears when the club space is linked to Eventor and has at least one map.",
  progress: (done: number, total: number) => `${done} of ${total} done`,
  done: "Done",
  todo: "To do",
  next: "Next step",
  hide: "Hide",
  hideLabel: "Hide Get started",
  steps: {
    eventor: {
      title: "Link the club to Eventor with the club's API key",
      help: `The key is in Eventor under ${EVENTOR_KEY_PLACE_EN}, and only the club's administrators in Eventor can reach it.`,
      linked: (club: string) => `Linked to Eventor · ${club}`,
      action: "Paste the key",
      noKey: "Don't have the key?"
    },
    people: {
      title: "Invite more leaders and administrators",
      help: "More people who can invite, confirm members and add trainings, so the club space does not depend on one person.",
      action: "To Members"
    },
    maps: {
      title: "Add maps or import the archive",
      help: "Upload a map file under Maps, or import the club's folder with trainings from your computer.",
      upload: "To Maps",
      import: "To Import"
    },
    access: {
      title: "Choose Who sees what",
      help: "The default already applies: all members see the training archive and may use the map bank. Change it if the maps should only be for leaders and admins.",
      action: "To Who sees what"
    }
  },
  ask: {
    open: "Ask the club's Eventor administrator to link",
    title: "Ask the club's Eventor administrator to link",
    intro: "Send the text to someone who is an administrator for the club in Eventor. They paste the key into O-Tid themselves and therefore need to be an administrator in the club space: invite them as Administrator under Members.",
    noSecret: "The text contains no key, and the key should not be sent to you. O-Tid sends nothing; you send the text yourself.",
    label: "The text to send",
    copy: "Copy the text",
    copied: "The text is copied.",
    copyFailed: "Could not copy. Select the text and copy it yourself.",
    mail: "Open in email",
    invite: "To Members",
    close: "Close",
    subject: (club: string) => `Link ${club} in O-Tid to Eventor`,
    body: (club: string, link: string) => [
      "Hi!",
      "",
      `I have started a club space for ${club} in O-Tid. O-Tid is course setting and timing for orienteering in the browser, for club events and trainings, with a club archive for the club's maps and courses.`,
      "",
      "The club space needs to be linked to Eventor with the club's API key. The link shows that the club space is the club's own, and members who are in Eventor are confirmed automatically. Only the club's administrators in Eventor can reach the key, so I need your help:",
      "",
      `1. Sign in to Eventor and go to ${EVENTOR_KEY_PLACE_EN}. The club's API key is there (create one if there is none).`,
      `2. Open the club space in O-Tid and sign in: ${link}`,
      "   You need to be an administrator in the club space. If you have not received an invitation from O-Tid: reply to me and I will invite you.",
      "3. Paste the key under the tab The club, in the field The club's API key, and choose Link to Eventor.",
      "",
      "Do not send the key to me or anyone else. O-Tid stores it encrypted and never shows it again.",
      "",
      "Thanks!"
    ].join("\n")
  }
};
