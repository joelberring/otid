import { nameList } from "./plural";
import type { InvitationKind, InvitationMailOutcome, InvitationRole } from "@o-tid/contracts";
import type { Texts } from "../lib/language";
import type { publicRaceSv } from "./public-race-sv";
import type { selfRegistrationSv } from "./self-registration-sv";
import type { accountSv } from "./account-sv";
import type { clubAffiliationSv } from "./club-affiliation-sv";
import type { courseDataSv } from "./course-data-sv";
import type { raceInfoSv } from "./race-info-sv";
import type { InvitationTally, invitationRoleWords, invitationSv } from "./invitation-sv";

/**
 * Engelska del 25: de sista bitarna i arbetsytan (Publicera, informationen till löparna, självregistreringen, arrangörsklubben,
 * banläggningens erbjudande, ta bort tävlingen) och inbjudningarna (länksidan, listorna och flera adresser). Mejlet är svenska.
 */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const publishEn: Texts<typeof publicRaceSv.publish> = {
  title: "Publish",
  help: "When the event is published, the event page is visible to everyone and the event is listed on the home page. Results appear as runners read out.",
  startListRelation: "The start list is published separately under Start and only becomes visible when you publish it there.",
  published: (when: string) => `Published ${when}. The event page is visible to everyone.`,
  unpublished: "Not published. Only you and others with access can see the event page (preview).",
  hidden: "Hidden by whoever runs O-Tid. The event is not public even if it is published.",
  status: { published: "Published", unpublished: "Not published", hidden: "Hidden" },
  publish: "Publish the event",
  unpublish: "Stop publishing",
  publishedNow: "The event is published.",
  unpublishedNow: "The event is no longer published.",
  failed: "The publication could not be changed. Try again.",
  page: "The event page",
  openPage: "Open the event page",
  previewPage: "Preview the event page",
  printQr: "Print QR code",
  newTab: "opens in a new tab"
};

export const notPublishedEn: Texts<typeof publicRaceSv.notPublished> = {
  title: "The event is not published",
  help: "The event does not exist or is not published yet. The organiser publishes it when it is ready.",
  organizer: "Organiser? Sign in to preview your event.",
  home: "To the home page"
};

export const resultNotFoundEn: Texts<typeof publicRaceSv.resultNotFound> = {
  title: "The result does not exist",
  help: "The result no longer exists, or the event is not published."
};

export const selfRegistrationCleanupEn: Texts<typeof selfRegistrationSv.cleanup> = {
  title: "Self-registered runners who have not read out",
  load: "Strike all self-registered runners who have not read out",
  help: "These registered themselves and have no readout or decision. Struck runners disappear from all lists and the card becomes free. Nothing is deleted.",
  count: (n: number) => `${n} self-registered ${n === 1 ? "runner" : "runners"} who have not read out`,
  none: "No self-registered runners to strike.",
  confirm: (n: number) => `Strike ${count(n, "self-registered runner", "self-registered runners")}`,
  cancel: "Cancel",
  retry: "Try again",
  saved: (struck: number, skipped: number) => `${count(struck, "self-registered runner is", "self-registered runners are")} struck.` +
    (skipped > 0 ? ` ${skipped} ${skipped === 1 ? "was" : "were"} left because they read out or changed in the meantime.` : ""),
  loadError: "The list could not be loaded. Try again.",
  saveError: "Nothing was struck. Try again."
};

export type SelfRegistrationSetting = Pick<typeof selfRegistrationSv, "setting" | "settingTitle" | "selfRegistered">;
export const selfRegistrationSettingEn: Texts<SelfRegistrationSetting> = {
  setting: {
    label: "Allow self-registration on the day of the event",
    help: "Anyone can register a new card with a name on the public page without signing in, but only on the day of the event and when the event is published.",
    helpParty: "Guests can link their name to their card on the party page without signing in, on the day of the party and the night after until 06:00, when the party is published.",
    on: "Self-registration is on.",
    off: "Self-registration is off.",
    failed: "The setting could not be saved."
  },
  settingTitle: "Self-registration",
  selfRegistered: "Self-registered"
};

export const raceDeleteEn: Texts<typeof accountSv.raceDelete> = {
  title: "Delete event",
  help: "The event is deleted completely: courses, classes, entries, raw readouts, radio punches, results, map, routes and the Eventor link. This cannot be undone.",
  ownerOnly: "Only the person who created the event can delete it.",
  confirm: (name: string) => `Type the event's name, ${name}, to confirm`,
  button: "Delete the event",
  mismatch: "The name does not match. Type the event's name exactly.",
  deleted: "The event is deleted."
};

export const clubRaceEn: Texts<typeof clubAffiliationSv.race> = {
  title: "The club and the club archive",
  help: "The organising club is only visible to people with access to the event. Before the event nothing about it is shown to the club.",
  organiser: "Organising club",
  noOrganiser: "None chosen",
  suggestion: (club: string) => `Suggestion: ${club} (your club)`,
  useSuggestion: "Use the suggestion",
  clearOrganiser: "No organising club",
  saved: "The organising club is saved.",
  noSpace: "The organising club has no club space linked to Eventor where you are an administrator.",
  space: (club: string) => `Club space: ${club}`,
  contents: "What goes into the club archive: the map file (as a map version), the course setting (.ppen) and the courses (IOF XML), and a link here. No start lists, results or participants.",
  noContents: "The event has no map file or courses to put in the archive yet.",
  withoutMap: (names: readonly string[]) => `${nameList(names, "and")} only have control codes and cannot be shown on the map. ${names.length === 1
    ? "The course is in the event but is not included" : "The courses are in the event but are not included"} in the archive's course files; the archive entry says so. Draw ${names.length === 1 ? "it" : "them"} in course setting first if ${names.length === 1 ? "it" : "they"} should be included.`,
  lift: "Put in the club archive",
  lifting: "Putting in the archive …",
  lifted: "The event is in the club archive.",
  openEntry: "Open in the club archive",
  unlift: "Take out of the club archive",
  unliftConfirm: "Take out of the club archive? The training in the archive is removed. The event does not change.",
  secrecyTitle: "The courses are secret",
  secrecy: "The event has not taken place yet (or not everyone has finished). If you put it in the club archive now, the club's members can see the courses before they run.",
  secrecyConfirm: "I understand that the courses are visible to the club before the event",
  since: (date: string) => `Added ${date}.`,
  autoLabel: "Put in the club archive when the training is over",
  autoHelp: "On by default for trainings. It goes into the archive when everyone has finished or has a decision, otherwise the day after, with the owner's or the responsible leader's permission (an administrator in the club space).",
  autoSaved: (on: boolean) => on ? "The training goes into the club archive when it is over." : "The training does not go into the club archive automatically.",
  autoRemoved: "It has been in the club archive and is not put there automatically again. Put it in by hand if it should be there.",
  autoProblem: {
    NO_ADMIN: "It could not be put in the club archive automatically: neither the owner nor the responsible leader is an administrator in the club space. Put it in by hand.",
    FAILED: "It could not be put in the club archive automatically. It is tried again within an hour; you can also put it in by hand."
  },
  reminder: "The event is over – put the courses in the club archive?",
  reminderOpen: "To The club and the club archive",
  errors: {
    NO_CLUB_ARCHIVE: "The organising club has no club space linked to Eventor where you are an administrator.",
    COURSES_SECRET: "Confirm the course secrecy first.",
    ALREADY_IN_ARCHIVE: "The event is already in the club archive."
  },
  failed: "That did not work. Try again."
};

export const courseDataOfferEn: Texts<typeof courseDataSv.offer> = {
  heading: "Course setting",
  empty: "The course setting has no courses yet. Put the course file's courses there, then you can move the start and the controls on the map.",
  create: "Put the courses in course setting",
  existing: "The course setting already has courses. The course file's courses can replace them.",
  replace: "Replace the course setting's courses …",
  confirm: "Replace the course setting's courses with the course file's? The current course setting is saved as an earlier version and can be restored under File → Earlier versions.",
  confirmYes: "Yes, replace",
  cancel: "Cancel",
  working: "Putting the courses in course setting …",
  done: "The courses are in course setting.",
  open: "Open course setting"
};

export const raceInfoSettingsEn: Texts<typeof raceInfoSv.settings> = {
  title: "Information for the runners",
  info: "Short information about the event",
  infoHelp: (n: number, max: number) => `Shown at the top of the event page and in the workspace. Plain text, line breaks are kept. ${n} of ${max} characters.`,
  infoTooLong: (max: number) => `At most ${max} characters.`,
  firstStart: "First start",
  firstStartHelp: "Clock time, e.g. 18:30. Information only: does not change start times, the draw or the event clock.",
  firstStartUnset: "Not set yet",
  firstStartFromDraw: "Set in Start → Draw and saved with the draw. The same time is shown to the runners.",
  firstStartOpenDraw: "Change in Draw",
  firstStartInvalid: "Write the clock time as HH:MM, for example 18:30, or leave the field empty.",
  cardNumbers: "Show card numbers in the public start list",
  cardNumbersHelp: "The card number is only shown in the start list, not in results, Live or speaker. A changed card shows only when the start list is published again. When turned off, the card number is hidden at once."
};

// Inbjudningarna

export const invitationRoleWordsEn: Texts<typeof invitationRoleWords> = {
  CLUB: { OWNER: "owner", ADMIN: "administrator", LEADER: "leader", READER: "member" },
  RACE: { ADMIN: "administrator", FUNCTIONARY: "official", COURSE_EDIT: "course setter – can edit",
    COURSE_SUGGEST: "course setter – can suggest changes", COURSE_COMMENT: "course setter – can read and comment",
    COURSE_MAP: "mapper – sees the map and the map errors" },
  GROUP: { LEADER: "leader", MEMBER: "member" },
  MAP_PROJECT: { OWNER: "owner", EDIT: "mapper – can edit", SUGGEST: "mapper – can suggest changes", READ: "can read" }
};
export const invitationRoleWordEn = (kind: InvitationKind, role: InvitationRole) =>
  (invitationRoleWordsEn[kind] as Partial<Record<InvitationRole, string>>)[role] ?? role.toLowerCase();

const longDate = (isoDate: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
  .format(new Date(`${isoDate}T12:00:00Z`));

export function invitationTargetPhraseEn(kind: InvitationKind, name: string, raceDate: string | null): string {
  if (kind === "CLUB") return `the club ${name}`;
  if (kind === "GROUP") return `the training group ${name}`;
  if (kind === "MAP_PROJECT") return `the map project ${name}`;
  return raceDate ? `the event ${name} on ${longDate(raceDate)}` : `the event ${name}`;
}

export const invitationEn: Texts<Pick<typeof invitationSv, "page" | "list" | "bulk">> = {
  page: {
    kicker: "O-Tid · Invitation",
    title: "Invitation",
    checking: "Fetching the invitation …",
    invalidTitle: "The invitation is no longer valid",
    invalid: "The link has expired, has been replaced by a newer invitation, or the invitation has been removed. If you have received a newer email, use the link in it. Otherwise you can ask the person who invited you to send it again.",
    noToken: "The link is missing its key. Open the link in the email again.",
    failed: "The invitation could not be fetched. Try again.",
    invited: (inviter: string | null, target: string, role: string) =>
      `${inviter === null ? "You have been invited" : `${inviter} has invited you`} to ${target} as ${role}.`,
    address: (email: string) => `The invitation is for the address ${email}. Sign in with that address, or create an account with it.`,
    howItWorks: "The invitation applies once you are signed in with the address and have confirmed it. If you create an account you first get an email with a link that confirms the address.",
    validUntil: (date: string) => `The link is valid until ${date}.`,
    register: "Create account",
    login: "Sign in",
    open: "Open",
    otherAccount: (email: string) => `You are signed in as ${email}. Sign out under My events and open the link again to sign in with the address in the invitation.`
  },
  list: {
    sent: (time: string) => `sent ${time}`,
    notSent: "not sent",
    resend: "Send again",
    resendLabel: (email: string) => `Send the invitation again to ${email}`,
    copy: "Copy the link",
    copyLabel: (email: string) => `Copy the invitation link for ${email}`,
    resent: (email: string) => `The invitation has been sent again to ${email}. The earlier link no longer works.`,
    copied: "The link is copied. Send it to the person yourself; it is valid for 14 days.",
    copyManually: "Copy the link here and send it to the person yourself; it is valid for 14 days.",
    linkField: "Invitation link",
    throttled: "Too many invitations right now. Wait a while and try again.",
    failed: "The invitation could not be sent. Try again in a while.",
    mailOff: "Email is not set up on the server. Copy the link and send it yourself."
  },
  bulk: {
    help: "One or more addresses, separated by commas, spaces or new lines. Everyone gets the same role and an email each.",
    tooMany: (max: number) => `At most ${max} addresses at a time.`,
    none: "Write at least one email address.",
    working: (done: number, total: number) => `Saving ${done} of ${total} …`
  }
};

const notSent = (n: number) => n === 1 ? "1 invitation saved but not sent" : `${n} invitations saved but not sent`;

export function invitationSummaryEn(tally: InvitationTally): string {
  const parts = [
    tally.sent > 0 ? `${count(tally.sent, "invitation", "invitations")} sent` : undefined,
    tally.saved > 0 ? `${count(tally.saved, "invitation", "invitations")} saved (copy the link in the list and send it yourself)` : undefined,
    tally.throttled > 0 ? `${notSent(tally.throttled)} (too many right now, send again later)` : undefined,
    tally.failed > 0 ? `${notSent(tally.failed)} (try Send again)` : undefined,
    tally.existing > 0 ? `${count(tally.existing, "address was", "addresses were")} already in the list` : undefined,
    tally.invalid > 0 ? `${count(tally.invalid, "address was", "addresses were")} invalid` : undefined,
    tally.other > 0 ? `${count(tally.other, "address", "addresses")} could not be saved` : undefined
  ].filter((part): part is string => part !== undefined);
  if (parts.length === 0) return "No addresses.";
  const text = parts.join(", ");
  return `${text[0]!.toUpperCase()}${text.slice(1)}.`;
}

export const invitationMailNoteEn: Record<InvitationMailOutcome, string> = {
  sent: "An invitation with a link has been sent to the address.",
  off: "Email is not set up on the server: copy the link in the list and send it yourself.",
  throttled: "The invitation was not sent (too many right now). Use Send again later.",
  failed: "The invitation could not be sent. Use Send again."
};

/** Engelska del 35: mejlet med inbjudan, på språket hos den som bjuder in. */
export const invitationMailEn: Texts<typeof invitationSv.mail> = {
  greeting: "Hello!",
  subject: (target: string) => `Invitation to ${target} in O-Tid`,
  invited: (inviter: string, target: string, role: string) => `${inviter} has invited you to ${target} in O-Tid as ${role}.`,
  open: "Open the link to accept the invitation. There you create an account with this address, or sign in if you already have one:",
  validUntil: (date: string) => `The link is valid until ${date}. The invitation applies once you have signed in with this address and confirmed it.`,
  ignore: "If you do not recognise the invitation you can ignore this message. Nothing happens unless you sign in.",
  signature: "O-Tid"
};
