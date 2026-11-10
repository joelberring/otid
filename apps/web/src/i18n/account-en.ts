import type { Texts } from "../lib/language";
import type { accountSv } from "./account-sv";
import type { accountMenuSv } from "./account-menu-sv";
import type { aiSv } from "./ai-sv";
import type { mapSourcesSv } from "./map-sources-sv";
import type { clubAffiliationSv } from "./club-affiliation-sv";

/** Engelska del 4: bekräftelsen av e-postadressen, Glömt lösenordet och lösenordsfälten (samma form som delarna av `accountSv`). */
export type AccountEntry = Pick<typeof accountSv, "genericError" | "networkError" | "logIn" | "passwordField" | "reset" | "verify">;

export const accountEntryEn: Texts<AccountEntry> = {
  genericError: status => `Something went wrong (${status}). Try again.`,
  networkError: "Could not reach the server. Check the connection and try again.",
  logIn: "Sign in",
  passwordField: {
    password: "Password",
    repeat: "Repeat the password",
    rule: "At least 8 characters.",
    tooShort: "The password is too short (at least 8 characters).",
    mismatch: "The passwords are not the same.",
    show: "Show the password",
    hide: "Hide the password"
  },
  reset: {
    kicker: "O-Tid · Account",
    title: "Forgot password",
    checking: "Checking …",
    intro: "Enter the email address of your account. We send a link where you choose a new password.",
    email: "Email address",
    invalidEmail: "Enter a valid email address.",
    send: "Send link",
    sending: "Sending …",
    sent: "If the address has an O-Tid account we have sent a link there. It is valid for an hour and can be used once. Also check the spam folder.",
    noMailTitle: "Reset by email is not switched on",
    noMail: "Contact whoever runs O-Tid and ask for a reset link. The link is valid for an hour.",
    contact: "Contact:",
    newTitle: "Choose a new password",
    newIntro: "Write the new password twice. You are signed in here and out on all other devices. If you have not confirmed the email address yet it is confirmed at the same time.",
    password: "New password",
    save: "Save and sign in",
    saving: "Saving …",
    saved: "The password is changed and you are signed in. Opening My events …",
    invalidLink: "The link is invalid, already used or has expired. Ask for a new link.",
    newLink: "Ask for a new link",
    backToLogin: "Back to sign in"
  },
  verify: {
    kicker: "O-Tid · Account",
    title: "Confirm the email address",
    intro: "Choose the password you want to sign in with and write it twice. It can be the same as when you created the account or a new one. Then the address is confirmed and you are signed in.",
    submit: "Confirm and sign in",
    verifying: "Confirming …",
    alreadyVerified: "The email address is already confirmed. Sign in with your password. If you have forgotten it you can choose a new one.",
    invalid: "The link has expired or is already used. Choose a new password via Forgot password; the address is confirmed at the same time and you are signed in.",
    newPassword: "Choose a new password",
    noToken: "The link is missing its key. Open the link in the email again."
  }
};

/** Del 7: Mitt konto (inte AI-kopplingen och Lantmäteriets uppgifter) och kontomenyn. */
export type AccountPage = Pick<typeof accountSv, "backToEvents" | "genericError" | "networkError" | "sessionExpired" | "logIn" | "me">;
export const accountPageEn: Texts<AccountPage> = {
  backToEvents: "My events",
  genericError: status => `Something went wrong (${status}). Try again.`,
  networkError: "Could not reach the server. Check the connection and try again.",
  sessionExpired: "You are not signed in.",
  logIn: "Sign in",
  me: {
    kicker: "O-Tid · Account",
    title: "My account",
    loading: "Fetching the account …",
    details: "Details",
    detailsHelp: "The email address is your sign-in and cannot be changed here.",
    email: "Email address",
    created: "Created",
    role: "Role",
    superadmin: "Superadmin",
    displayName: "Name",
    saveName: "Save name",
    nameSaved: "The name is saved.",
    password: "Change password",
    passwordHelp: "All other sign-ins stop working. This device stays signed in. If you sign in with Google and have no password of your own: choose one with Forgot password.",
    currentPassword: "Current password",
    newPassword: "New password",
    savePassword: "Change password",
    passwordSaved: "The password is changed. Other devices need to sign in again.",
    wrongPassword: "The password is wrong.",
    delete: "Delete the account",
    deleteHelp: "The account, your name, your email address and your password are deleted. It cannot be undone.",
    deleteEvents: "The events you created are deleted at the same time, with entries, readouts and results:",
    deleteNoEvents: "You own no events. Events where you are co-administrator stay with their owners.",
    deleteOthers: "Events where you are co-administrator stay with their owners; you only disappear as administrator.",
    deletePassword: "Write your password to confirm",
    deleteButton: "Delete my account",
    deleteHandOver: names => `Hand over the ownership of ${names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names.at(-1)} first. `
      + "The account cannot be deleted as long as nobody else can manage them.",
    deleteHandOverAlone: "Make someone else owner (club) or leader (group) under Members. If you are alone there: contact whoever runs O-Tid.",
    deleteSoleOwner: "The account is not deleted: hand over the ownership first (see above).",
    soleOwnerClub: name => `The club ${name} – you are the only owner`,
    soleOwnerGroup: name => `The training group ${name} – you are the only leader`,
    soleOwnerMapProject: name => `The map project ${name} – you are the only owner`,
    deleted: "The account is deleted.",
    deleteWithGoogle: "You sign in with Google and have no password of your own. Confirm by signing in with Google once more – then the account is deleted directly.",
    deleteWithGoogleButton: "Sign in with Google and delete the account",
    deleteGoing: "Going to Google …",
    deleteDone: {
      "annat-konto": "The account is not deleted: you signed in with a different Google account than the one linked here.",
      "for-gammal": "The account is not deleted: Google did not confirm a new sign-in. Try again and sign in at Google when asked.",
      "ensam-agare": "The account is not deleted: hand over the ownership first (see above).",
      losenord: "The account has its own password. Confirm the deletion with the password.",
      sessionen: "The deletion was for another sign-in. Try again from here.",
      avbruten: "Signing in at Google was cancelled. The account is not deleted.",
      fel: "Deleting with Google failed. The account is not deleted. Try again."
    },
    google: "Sign in with Google",
    googleHelp: "Link your Google account, also if it has a different email address than the account. Then you can sign in with Google. The account's email address does not change.",
    googleLink: "Link Google account",
    googleLinking: "Going to Google …",
    googleLinked: email => `Linked Google account: ${email}`,
    googleLinkedUnknown: "A Google account is linked. The address is shown after the next sign-in with Google.",
    googleNone: "No Google account is linked.",
    googleUnlink: "Remove the link",
    googleUnlinked: "The link is removed. You sign in with the email address and password.",
    googleLastMethod: "The link cannot be removed: the account has no password of its own. Sign out and choose one with Forgot password (to the account's email address) first.",
    googleDone: {
      kopplat: email => `The Google account (${email}) is linked – you can sign in with Google.`,
      upptaget: "The Google account is linked to another account in use. Sign in to that one and remove the link there first.",
      "upptaget-utan-losenord": "The Google account is linked to another account in use that has no password of its own. "
        + "Sign out and choose Forgot password with that account's email address (usually the Google account's) to give it a password. Then sign in "
        + "to it, remove the link under My account and link Google here again.",
      obekraftad: "Google has not confirmed the email address of the Google account. Confirm it at Google and try again.",
      sessionen: "The link was for another sign-in. Sign in again and press Link Google account once more.",
      avbruten: "The link was cancelled at Google. Nothing is changed.",
      fel: "Linking to Google failed. Try again."
    },
    moved: email => `The Google account (${email}) is linked – you can sign in with Google. The empty account is deleted.`,
    sessions: "Sign-ins",
    sessionsHelp: "If you signed in on a borrowed computer or lost your phone: sign out everywhere. You sign in again here afterwards.",
    logoutAll: "Sign out from all devices",
    logoutAllFailed: "Signing out could not be confirmed. Check the network and try again."
  }
};

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
export const accountMenuEn: Texts<typeof accountMenuSv> = {
  open: name => `Account: ${name}`,
  myClubs: "My clubs",
  myGroups: "My groups",
  myMapProjects: "My map projects",
  myEvents: "My events",
  myAccount: "My account",
  logout: "Sign out",
  loggingOut: "Signing out …",
  checking: "Checking changes that are waiting …",
  pending: count => `${n(count, "change is", "changes are")} waiting for the network – sign out anyway?`,
  pendingCourseSetting: "Course setting changes that have not been sent are lost.",
  pendingTracks: count => `${n(count, "track or note", "tracks and notes")} from the map projects that have not been sent are lost.`,
  pendingReadouts: count => `${n(count, "readout stays", "readouts stay")} on the computer until sent.`,
  logoutAnyway: "Sign out anyway",
  cancel: "Cancel",
  failed: status => `Signing out could not be confirmed (${status}). Check the network and try again.`,
  network: "Signing out could not be confirmed. Check the network and try again.",
  guestBadge: "Guest mode",
  guestNote: until => `This is a practice event with made-up runners. Nothing is shown publicly, and everything is deleted on ${
    until.toLocaleString("en-GB", { weekday: "long", hour: "2-digit", minute: "2-digit" })}.`,
  createAccount: "Create your own account",
  endGuest: "End the trial"
};

/** Engelska del 9: AI-kopplingarna på Mitt konto. */
export const aiConnectionsEn: Texts<typeof aiSv.connections> = {
  title: "AI connections",
  help: "Claude (or another AI service) that you have connected with your own account there. It sees your map projects and, if you approved course setting, the courses where you may set courses. It only leaves suggestions and notes. A connection from before 8 November only sees the map projects; remove it and connect again to allow course setting.",
  none: "No AI connections. Add O-Tid as a connector in Claude with the address below.",
  address: "Address to add in Claude",
  copy: "Copy the address",
  copied: "The address is copied.",
  howTitle: "How to connect Claude",
  how: [
    "Copy the address above.",
    "Open Claude (claude.ai or the app) → Settings → Connectors → Add custom connector. Enter the name O-Tid and paste the address. If you do not see the option, your plan or organisation may not have it.",
    "Press Connect. O-Tid opens: sign in if needed, read what the connection may do and press Allow. The connection then appears in the list here.",
    "In a chat: turn on O-Tid among the tools (the button for tools and connectors) and write, for example, “Show my map projects in O-Tid”.",
    "Claude asks for permission before it uses O-Tid (“Allow once” or “Always allow”). You must approve it for anything to happen, and you can refuse. Changes to the map still only become suggestions that you or the project's owner approve."
  ],
  created: date => `connected ${date}`,
  used: date => `last used ${date}`,
  neverUsed: "not used yet",
  revoked: "removed",
  revoke: "Remove",
  revokedDone: "The connection is removed.",
  failed: "The connections could not be fetched."
};

/** Engelska del 9: de egna uppgifterna till Lantmäteriet på Mitt konto. */
export const mapSourcesAccountEn: Texts<typeof mapSourcesSv.account> = {
  title: "Lantmäteriet (Swedish mapping authority)",
  help: "Your own credentials for Lantmäteriet, to fetch orthophotos and laser data for the map projects. O-Tid has no account of its own at Lantmäteriet. "
    + "The credentials are stored encrypted, only used when you fetch and never shown again. The products (Ortofoto Nedladdning, Laserdata Nedladdning skog) must be ordered on Geotorget.",
  method: "How to sign in",
  basic: "Geotorget username and password (private person)",
  oauth: "API portal key and secret (the organisation's system account)",
  id: method => method === "BASIC" ? "Username" : "Key (consumer key)",
  secret: method => method === "BASIC" ? "Password" : "Secret (consumer secret)",
  save: "Save the credentials",
  remove: "Remove the credentials",
  saved: (method, hint, date) => `Saved ${date}: ${method === "BASIC" ? "username" : "key"} ending in …${hint}.`,
  unreadable: "The server's key has changed since the credentials were saved. Save them again.",
  none: "No credentials saved.",
  notConfigured: "The server cannot store credentials (the master key is missing). Contact whoever runs O-Tid.",
  savedDone: "The credentials are saved.",
  removedDone: "The credentials are removed.",
  failed: "That did not work. Try again.",
  trial: "Being tested: fetching from Lantmäteriet follows their guides but has not been tried against the real service yet."
};

/** Engelska del 10: Mina klubbar, klubbvalet efter registreringen och klubbsökningen. */
export type ClubAffiliationAccount = Pick<typeof clubAffiliationSv, "picker" | "status" | "confirmedVia" | "step" | "onboarding" | "account">;

export const clubAffiliationAccountEn: Texts<ClubAffiliationAccount> = {
  picker: {
    search: "Search club",
    placeholder: "e.g. Älvsjö or OKÄÖ",
    none: "No club matches. Write the name under Other club.",
    emptyDirectory: "The club list has not been fetched on this server yet. Write the club's name under Other club.",
    remove: name => `Remove ${name}`,
    other: "Other club",
    otherHelp: "If the club is not in the list (for example a club outside Sweden)."
  },
  status: { PENDING: "Waiting for confirmation", CONFIRMED: "Confirmed", DECLINED: "Not confirmed by the club" },
  confirmedVia: { EVENTOR: "confirmed via Eventor", MANUAL: "confirmed by the club" },
  step: {
    title: "Which club do you belong to?",
    intro: "Optional. Choose your club, so that the club's leaders can invite you to events and trainings, and you can see the club's archive once the club has confirmed you.",
    save: "Save the clubs",
    skip: "Skip",
    later: "You can change it later under My account → My clubs.",
    failed: "The clubs could not be saved. Try again."
  },
  onboarding: {
    member: club => `You are a member of ${club}`,
    open: "Open the club space",
    pending: club => `${club}: waiting for confirmation`,
    pendingHelp: "The club's administrators confirm you. It is quicker if your address in Eventor is the same as here.",
    noSpace: "Nobody from the club has started the club space yet – are you an admin in Eventor? Start it here",
    start: "Start the club space",
    starting: "Starting …",
    startFailed: "The club space could not be started. Try again."
  },
  account: {
    title: "My clubs",
    help: "The clubs you belong to. A club confirms you (automatically via Eventor or by the club's administrators) before you see anything in the club space.",
    empty: "You have not chosen any club.",
    add: "Add the club",
    addOther: "Add",
    remove: "Remove",
    removeConfirm: name => `Remove ${name} from your clubs? If you are confirmed, what you see in the club space also disappears.`,
    exists: "The club is already in the list.",
    saved: "The clubs are saved.",
    failed: "That did not work. Try again."
  }
};

/** Engelska del 36: sidan som bekräftar att Google-kopplingen flyttas från ett tomt konto (ADR-0205 tillägg). */
export const googleMoveEn: Texts<typeof accountSv.googleMove> = {
  kicker: "O-Tid · Account",
  title: "Move the Google link here",
  loading: "Reading the link …",
  what: (google: string, source: string, target: string) => `The Google account ${google} is linked to another account in O-Tid (${source}). `
    + `That account is empty: no events, permissions, clubs or archive content (only the answer about which club you belong to). The link is moved to ${target}, and you then sign in with Google here.`,
  duplicate: (source: string, created: string) => `The account ${source} (created ${created}) is removed as a duplicate and signed out everywhere. Invitations to the address remain.`,
  password: "Your password",
  passwordHelp: "Confirm the move with this account's password.",
  recentLogin: "You signed in just now, so confirming is enough.",
  loginAgain: "Sign out and in again, then link Google once more (the account has no password of its own, and the sign-in is older than ten minutes).",
  confirm: "Move the link and remove the duplicate",
  cancel: "Cancel",
  expired: "The move no longer applies (too old, or a different sign-in). Press Link Google account under My account again.",
  inUse: "The Google account is linked to another account that is in use. Sign in to that one and remove the link there first.",
  wrongPassword: "The password is not correct."
};
