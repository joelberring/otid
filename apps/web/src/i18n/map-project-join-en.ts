import type { Texts } from "../lib/language";
import type { mapProjectJoinSv } from "./map-project-join-sv";

/** Invite to a map project without email (club members and a link), and the page that receives the link. */
export const mapProjectJoinEn: Texts<typeof mapProjectJoinSv> = {
  members: {
    title: "Club members",
    help: (clubs: readonly string[]) => `Add a member of ${clubs.join(", ")} directly, without email. Only names are shown, and only from your clubs.`,
    search: "Search by name",
    role: "Role",
    add: "Add",
    addLabel: (name: string) => `Add ${name}`,
    added: (name: string) => `${name} is now in the project.`,
    none: "No more club members to add.",
    noMatch: "No club member with that name.",
    loading: "Reading the club members …",
    failed: "The club members could not be read.",
    gone: "The person cannot be added (they may already be in the project).",
    from: (clubs: readonly string[]) => clubs.join(", ")
  },
  link: {
    title: "Link",
    help: "Create a link with a role. Whoever opens the link signed in becomes a member. The link is valid for 14 days, can be used by several people and can be removed.",
    create: "Create link",
    created: "The link is created. It is shown only now: copy it and send it.",
    copied: "The link is copied.",
    field: "Link to send",
    copy: "Copy the link",
    open: "Open links",
    none: "No open links.",
    line: (role: string, until: string) => `${role}, valid until ${until}`,
    remove: "Remove the link",
    removeLabel: (role: string, until: string) => `Remove the link (${role}, until ${until})`,
    removed: "The link is removed. Those who already joined stay.",
    tooMany: "There are already twenty open links. Remove one first.",
    failed: "The link could not be created."
  },
  page: {
    kicker: "Map project",
    title: "Join the map project",
    checking: "Checking the link …",
    noToken: "The link has no key. Open the link you were sent again, or ask for a new one.",
    failed: "The link could not be checked. Try again.",
    invalidTitle: "The link is not valid",
    invalid: "The link has been removed or has expired. Ask the sender for a new link.",
    invited: (inviter: string | null, project: string, role: string) =>
      `${inviter ?? "Someone"} has invited you to the map project ${project} as ${role}.`,
    validUntil: (until: string) => `The link is valid until ${until}.`,
    signedOut: "Sign in or create an account in O-Tid, then open the link again.",
    join: "Join",
    joining: "Joining …",
    joined: (project: string) => `You are in ${project}.`,
    open: "Open the project",
    verify: "Confirm your email address first (the link in the email you got when you created the account), then open the link again.",
    refused: "The link is no longer valid or the account may not join."
  }
};
