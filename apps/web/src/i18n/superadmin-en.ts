import type { Texts } from "../lib/language";
import { plural } from "./plural";
import type { superadminSv } from "./superadmin-sv";

/** Engelska del 35: superadminsidan. */
export const superadminEn: Texts<typeof superadminSv> = {
  kicker: "O-Tid · Operations",
  title: "Superadmin",
  intro: "All accounts and events. Every action needs a reason and is logged with who and when.",
  loading: "Loading …",
  forbidden: "This page is only for superadmins.",
  notLoggedIn: "Sign in with a superadmin account.",
  accounts: "Accounts",
  accountsHelp: (shown: number, total: number) => shown < total ? `Showing the latest ${shown} of ${total}. Search to find more.`
    : `${plural(total, "account", "accounts")}, newest first.`,
  searchAccounts: "Search email or name",
  races: "Events",
  racesHelp: (shown: number, total: number) => shown < total ? `Showing the latest ${shown} of ${total}. Search to find more.`
    : `${plural(total, "event", "events")}, newest first.`,
  searchRaces: "Search event, race or owner",
  search: "Search",
  noAccounts: "No accounts match.",
  noRaces: "No events match.",
  columns: {
    email: "Email", name: "Name", created: "Created", lastLogin: "Last signed in", events: "Events", status: "Status",
    race: "Event", date: "Date", owner: "Owner", type: "Type", actions: "Actions"
  },
  never: "never",
  noOwner: "none",
  status: { active: "Active", blocked: "Blocked", superadmin: "Superadmin", visible: "Visible", hidden: "Hidden",
    unverified: "Unconfirmed address" },
  action: {
    HIDE_RACE: "Hide", UNHIDE_RACE: "Show", DELETE_EVENT: "Delete", BLOCK_ACCOUNT: "Block", UNBLOCK_ACCOUNT: "Unblock",
    DELETE_ACCOUNT: "Delete", CREATE_RESET_LINK: "Reset link", VERIFY_EMAIL: "Confirm the address", SET_ACCOUNT_LIMITS: "Limits", SET_INSTALLATION_LIMITS: "Change",
    GRANT_SUPERADMIN: "Granted superadmin", REVOKE_SUPERADMIN: "Removed superadmin"
  },
  logAction: {
    HIDE_RACE: "Hid event", UNHIDE_RACE: "Showed event", DELETE_EVENT: "Deleted event", BLOCK_ACCOUNT: "Blocked account",
    UNBLOCK_ACCOUNT: "Unblocked account", DELETE_ACCOUNT: "Deleted account", CREATE_RESET_LINK: "Created reset link",
    VERIFY_EMAIL: "Confirmed address", SET_ACCOUNT_LIMITS: "Changed limits", SET_INSTALLATION_LIMITS: "Changed the installation's limits", GRANT_SUPERADMIN: "Granted superadmin", REVOKE_SUPERADMIN: "Removed superadmin"
  },
  confirmTitle: {
    HIDE_RACE: "Hide the event from the public pages", UNHIDE_RACE: "Show the event on the public pages again",
    DELETE_EVENT: "Delete the event with all data", BLOCK_ACCOUNT: "Block the account", UNBLOCK_ACCOUNT: "Unblock the account",
    DELETE_ACCOUNT: "Delete the account", CREATE_RESET_LINK: "Create reset link", VERIFY_EMAIL: "Confirm the account's email address",
    SET_ACCOUNT_LIMITS: "Change the account's limits", SET_INSTALLATION_LIMITS: "Change the installation's limits"
  },
  confirmHelp: {
    HIDE_RACE: "Start lists, results and split times stop being shown to visitors. The organiser sees the event as usual.",
    UNHIDE_RACE: "The event is shown to visitors again.",
    DELETE_EVENT: "Everything is deleted: entries, raw readouts, radio punches, results, map, routes and Eventor link. It cannot be undone.",
    BLOCK_ACCOUNT: "The account is signed out everywhere and cannot sign in until it is unblocked.",
    UNBLOCK_ACCOUNT: "The account can sign in again. Old sign-ins no longer apply.",
    DELETE_ACCOUNT: "The account and the events it owns are deleted. It cannot be undone.",
    CREATE_RESET_LINK: "The link is shown once. Give it to the account's owner; it is valid for one hour and can be used once.",
    VERIFY_EMAIL: "Only do this if you know the address belongs to the person and that they chose the account's password themselves (for example if the email never arrives). Permissions others have given the address then apply at once. The password is not changed; if you are unsure, create a reset link instead.",
    SET_ACCOUNT_LIMITS: "The limits apply to this account only. Leave a field empty for the account to follow the default. Lowering a limit deletes nothing; the account just cannot save more until it is below the limit.",
    SET_INSTALLATION_LIMITS: "The cache is the copy on the server's disk of what is in the store; when it is full, what was used least recently is removed (it remains in the store). Maps for races and trainings are pinned from the day before to the day after and count outside the limit, with a limit of their own that only warns. The total limit applies to all map storage on the installation (0 = no limit). Leave a field empty for the default."
  },
  ownedEvents: (count: number) => count === 1 ? "The account owns 1 event, which is also deleted." : `The account owns ${count} events, which are also deleted.`,
  limits: "Storage and laser tiles",
  limitsHelp: (usedMb: number, limitMb: number | null, defaultMb: number | null, defaultTiles: number, defaultRegenerableMb: number) =>
    `Map files: ${usedMb} MB${limitMb === null ? "" : ` of ${limitMb} MB`}. Default per account: ${defaultMb === null ? "no limit" : `${defaultMb} MB`} of storage for own material, ${defaultRegenerableMb} MB for regenerable content and ${defaultTiles} laser tiles a month. The list shows accounts that have used at least 70% of a limit and accounts with limits of their own, closest to the limit first.`,
  limitsEmpty: "No account is near its limit and none has limits of its own.",
  limitColumns: { storage: "Map storage", tiles: "Laser tiles this month", own: "Own limits" },
  storageUse: (usedMb: number, limitMb: number | null, percent: number | null) =>
    limitMb === null ? `${usedMb} MB (no limit)` : `${usedMb} of ${limitMb} MB (${percent}%)`,
  tilesUse: (used: number, limit: number) => `${used} of ${limit}`,
  ownLimits: (mapQuotaMb: number | null, tiles: number | null, regenerableMb: number | null = null) =>
    mapQuotaMb === null && tiles === null && regenerableMb === null ? "Default" : [mapQuotaMb === null ? null : `${mapQuotaMb} MB`,
      regenerableMb === null ? null : `${regenerableMb} MB regenerable`, tiles === null ? null : `${tiles} tiles`].filter(Boolean).join(", "),
  showStorage: "Show storage",
  storageOf: (email: string) => `Storage for ${email}`,
  nearLimit: "Near the limit",
  overLimit: "Over the limit",
  mapQuotaField: (defaultMb: number | null) => `Map storage in MB (empty = the default${defaultMb === null ? ", no limit" : ` ${defaultMb}`})`,
  geoTilesField: (defaultTiles: number) => `Laser tiles per month (empty = the default ${defaultTiles})`,
  regenerableQuotaField: (defaultMb: number) => `Regenerable content in MB, for example laser runs and fetched underlays (empty = the default ${defaultMb})`,
  cacheMaxField: (defaultMb: number) => `Cache limit in MB (empty = the default ${defaultMb})`,
  pinMaxField: (defaultMb: number) => `Limit for pinned race maps in MB (empty = the default ${defaultMb})`,
  totalQuotaField: (defaultMb: number | null) => `Total map storage in MB, 0 = no limit (empty = the default${defaultMb === null ? ", no limit" : ` ${defaultMb}`})`,
  installation: {
    title: "The installation",
    label: "The installation",
    store: "The store",
    storeMode: { off: "Off: map content is saved in the database", on: "On: new map content is saved in object storage",
      incomplete: "Switched on but not in use (the object storage credentials or the cache are missing; see the log)" },
    cache: "The cache",
    cacheUse: (usedMb: number | null, capMb: number, files: number | null, isDefault: boolean) =>
      `${usedMb === null ? "unknown" : `${usedMb} MB`} of ${capMb} MB${isDefault ? " (default)" : ""}${files === null ? "" : `, ${files} files`}`,
    fetches: "Fetches from the store",
    fetchesUse: (today: number, todayMb: number, yesterday: number) => `${today} today (${todayMb} MB), ${yesterday} yesterday`,
    pinned: "Pinned for races",
    pinnedUse: (count: number, mb: number, limitMb: number, isDefault: boolean) =>
      `${count} ${count === 1 ? "item" : "items"}, ${mb} MB (limit ${limitMb} MB${isDefault ? ", default" : ""}); maps for races and trainings from the day before to the day after, outside the cache limit`,
    pinnedUnknown: "Unknown (the cache cannot be read here)",
    pinnedMissing: (count: number, mb: number) => `${count} of the pinned items (${mb} MB) are missing from the cache. They are fetched every 5 minutes; if this remains, see the log ("Fastspikningen").`,
    pinnedMissingToday: (count: number, mb: number) => `A race today is missing ${count} map items (${mb} MB) in the cache. They will then be read from the store over the network. See the log ("Fastspikningen") and check the connection to object storage.`,
    pinnedOverLimit: (mb: number, limitMb: number) => `The pinned content (${mb} MB) is over the limit of ${limitMb} MB. Everything is pinned anyway (the race comes first); raise the limit or make sure the disk is large enough.`,
    total: "Total map storage",
    totalUse: (usedMb: number, limitMb: number | null, isDefault: boolean) =>
      `${usedMb} MB${limitMb === null ? " (no limit)" : ` of ${limitMb} MB`}${isDefault ? " (default)" : ""}`,
    change: "Change the installation's limits"
  },
  target: "Applies to",
  reason: "Reason (logged)",
  confirmName: (name: string) => `Type the event's name, ${name}, to confirm`,
  confirmEmail: (email: string) => `Type the account's email address, ${email}, to confirm`,
  perform: "Carry out",
  cancel: "Cancel",
  working: "Carrying out …",
  done: (label: string) => `Done: ${label}.`,
  mismatch: "The confirmation does not match. Type the name or the address exactly.",
  notFound: "No longer exists. The list has been updated.",
  ownAccount: "You change your own account under My account.",
  alreadyVerified: "The address is already confirmed. The list has been updated.",
  resetTitle: "Reset link",
  resetHelp: (time: string) => `Valid until ${time}, once. It is only shown now.`,
  copy: "Copy the link",
  copied: "The link has been copied.",
  copyFailed: "Could not copy. Select the link and copy it.",
  closeLink: "Close",
  log: "Log",
  logHelp: "Latest actions, newest first. The log cannot be changed.",
  logEmpty: "No actions yet.",
  logColumns: { when: "When", who: "Who", what: "What", target: "Target", reason: "Reason" }
};
