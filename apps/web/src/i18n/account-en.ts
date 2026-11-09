import type { Texts } from "../lib/language";
import type { accountSv } from "./account-sv";

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
