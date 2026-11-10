import type { Texts } from "../lib/language";
import type { aiSv } from "./ai-sv";

/** Godkännandet av en AI-koppling på engelska (översynen 2026-11-10, E). Kopplingarna på Mitt konto ligger i `account-en.ts`. */
export const aiAuthorizeEn: Texts<typeof aiSv.authorize> = {
  kicker: "O-Tid · AI connection",
  title: "Connect an AI to your account",
  checking: "Fetching the request …",
  loginNeeded: "Sign in to O-Tid to approve the connection. You will come back here afterwards.",
  login: "Sign in",
  asks: client => `${client} wants access to your O-Tid account.`,
  account: email => `Signed in as ${email}.`,
  can: "The connection can",
  canItems: {
    kartprojekt: ["see the map projects you are a member of: the maps, the objects and pictures of them",
      "suggest changes, which an owner of the project approves or rejects"],
    banlaggning: ["see the course setting in events where you may set courses: courses, controls, descriptions, levels and pictures of the courses",
      "leave notes in the course setting (review and suggestions), which you or the course setter read and decide on"]
  },
  cannot: courseSetting => courseSetting
    ? "The connection cannot change a map or a course directly, see participants and results or anything else in O-Tid."
    : "The connection cannot change a map directly, see your events or anything else in O-Tid.",
  redirect: host => `The answer is sent to ${host}.`,
  revokeHint: "You can remove the connection at any time under My account → AI connections.",
  approve: "Allow",
  deny: "Deny",
  sending: "Sending …",
  invalid: description => `The request cannot be approved: ${description}`,
  failed: "Something went wrong. Try again from the beginning in the AI service."
};
