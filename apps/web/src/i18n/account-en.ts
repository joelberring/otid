import type { Texts } from "../lib/language";
import type { accountSv } from "./account-sv";
import type { accountMenuSv } from "./account-menu-sv";

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
  network: "Signing out could not be confirmed. Check the network and try again."
};
