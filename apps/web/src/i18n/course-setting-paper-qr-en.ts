import type { Texts } from "../lib/language";
import type { paperQrSv } from "./course-setting-paper-qr-sv";

/** The paper's QR code: where it leads, its size, the text below it and the warnings. */
export const paperQrEn: Texts<typeof paperQrSv> = {
  target: "Leads to",
  targets: {
    RACE: "The race page",
    BINGO: "Bingo/Battleships: sign up",
    OTID: "O-Tid",
    CUSTOM: "Own address"
  },
  url: "Address (https://…)",
  urlInvalid: "The address must start with https:// and may not contain spaces.",
  size: "Size (mm)",
  caption: "Text below the code",
  captions: { AUTO: "The address", OWN: "Own text", NONE: "No text" },
  captionText: "Text",
  address: (address: string) => `The code leads to ${address}.`,
  help: "The code is drawn as black squares on white and stays sharp in print. Scan a test print with your phone.",
  notPublished: "The race is not published – the link works only once it is.",
  bingoOff: "Bingo on the phone is not switched on for the race. The code shows as a box until it is.",
  unknown: "The race's address is not known here. The code shows as a box."
};
