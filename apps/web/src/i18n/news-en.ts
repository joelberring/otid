import type { Texts } from "../lib/language";
import type { newsSv } from "./news-sv";

/** ADR-0230: the news feed «New in O-Tid». */
export const newsEn: Texts<typeof newsSv> = {
  title: "New in O-Tid",
  films: "Films",
  imageAlt: title => `Picture for the news item ${title}`,
  editor: {
    generalTitle: "News",
    generalHelp: "General news is shown to everyone on the start page under New in O-Tid (at most three, newest first). Club news is listed here too; you can edit, hide or remove it.",
    clubTitle: "Club news",
    clubHelp: "The news is shown to the club's signed-in members on the start page under New in O-Tid, marked with the club's name, and here. Never to visitors or other clubs.",
    clubReadHelp: "News from the club's leaders. It is also shown on the start page when you are signed in.",
    newItem: "Write a news item",
    editItem: "Edit the news item",
    heading: "Heading",
    body: "Short text",
    link: "Link (optional)",
    linkHelp: "A page in O-Tid (e.g. /om) or an address starting with https://.",
    image: "Picture (optional)",
    imageHelp: "Shown small in 16:9 (cropped if needed). It is scaled down before it is sent.",
    removeImage: "Remove the picture",
    keepImage: "The picture is kept.",
    hidden: "Hidden (not shown to readers)",
    publish: "Publish",
    save: "Save",
    cancel: "Cancel",
    edit: "Edit",
    hide: "Hide",
    show: "Show",
    remove: "Remove",
    confirmRemove: title => `Remove the news item “${title}”? This cannot be undone.`,
    hiddenBadge: "Hidden",
    general: "General",
    empty: "No news yet.",
    loading: "Loading the news …",
    saved: "Saved.",
    removed: "The news item is removed.",
    failed: "That did not work. Try again.",
    invalid: "Check the heading, the link and the picture.",
    forbidden: "You may not write news here.",
    imageFailed: "The picture could not be read. Choose a JPEG, PNG or WebP picture.",
    imageTooLarge: "The picture is too large even after scaling down."
  }
};
