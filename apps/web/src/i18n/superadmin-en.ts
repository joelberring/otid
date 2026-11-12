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
    DELETE_ACCOUNT: "Delete", CREATE_RESET_LINK: "Reset link", VERIFY_EMAIL: "Confirm the address",
    GRANT_SUPERADMIN: "Granted superadmin", REVOKE_SUPERADMIN: "Removed superadmin"
  },
  logAction: {
    HIDE_RACE: "Hid event", UNHIDE_RACE: "Showed event", DELETE_EVENT: "Deleted event", BLOCK_ACCOUNT: "Blocked account",
    UNBLOCK_ACCOUNT: "Unblocked account", DELETE_ACCOUNT: "Deleted account", CREATE_RESET_LINK: "Created reset link",
    VERIFY_EMAIL: "Confirmed address", GRANT_SUPERADMIN: "Granted superadmin", REVOKE_SUPERADMIN: "Removed superadmin"
  },
  confirmTitle: {
    HIDE_RACE: "Hide the event from the public pages", UNHIDE_RACE: "Show the event on the public pages again",
    DELETE_EVENT: "Delete the event with all data", BLOCK_ACCOUNT: "Block the account", UNBLOCK_ACCOUNT: "Unblock the account",
    DELETE_ACCOUNT: "Delete the account", CREATE_RESET_LINK: "Create reset link", VERIFY_EMAIL: "Confirm the account's email address"
  },
  confirmHelp: {
    HIDE_RACE: "Start lists, results and split times stop being shown to visitors. The organiser sees the event as usual.",
    UNHIDE_RACE: "The event is shown to visitors again.",
    DELETE_EVENT: "Everything is deleted: entries, raw readouts, radio punches, results, map, routes and Eventor link. It cannot be undone.",
    BLOCK_ACCOUNT: "The account is signed out everywhere and cannot sign in until it is unblocked.",
    UNBLOCK_ACCOUNT: "The account can sign in again. Old sign-ins no longer apply.",
    DELETE_ACCOUNT: "The account and the events it owns are deleted. It cannot be undone.",
    CREATE_RESET_LINK: "The link is shown once. Give it to the account's owner; it is valid for one hour and can be used once.",
    VERIFY_EMAIL: "Only do this if you know the address belongs to the person and that they chose the account's password themselves (for example if the email never arrives). Permissions others have given the address then apply at once. The password is not changed; if you are unsure, create a reset link instead."
  },
  ownedEvents: (count: number) => count === 1 ? "The account owns 1 event, which is also deleted." : `The account owns ${count} events, which are also deleted.`,
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
