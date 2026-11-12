import type { Texts } from "../lib/language";
import type { accessSv } from "./access-sv";

export const accessEn: Texts<typeof accessSv> = {
  checking: "Checking your sign-in …",
  signedOut: "You are not signed in. Sign in with your account.",
  signIn: "Sign in",
  noAccess: (email: string) => `You are signed in as ${email} but do not have access to this event.`,
  noAccessHelp: "Ask the event's administrator to invite you with that address, or sign out and sign in with another account.",
  unverified: (email: string) => `You are signed in as ${email}, but the address is not confirmed. If you have been invited: confirm your email address for the access to apply.`,
  myRaces: "Go to My events",
  confirmHeading: "Confirm your email address",
  confirmInvitation: (email: string) => `You are signed in as ${email}, but the address is not confirmed, so the invitation does not apply yet. Confirm your email address for the access to apply.`,
  confirmHow: "You will get an email with a link. Open the link and choose a password; then the address is confirmed and the access applies.",
  send: "Send confirmation email",
  sending: "Sending …",
  sent: (email: string) => `The email has been sent to ${email}. Open the link in it; it is valid for one hour.`,
  mailOff: "Email is not set up on the server, so no email can be sent. Ask whoever runs O-Tid to confirm the address.",
  failed: "The email could not be sent. Try again in a while."
};
