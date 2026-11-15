import type { Texts } from "../lib/language";
import type { mapProjectPrintSv } from "./map-project-print-sv";

export const mapProjectPrintEn: Texts<typeof mapProjectPrintSv> = {
  button: "Print PDF",
  help: "The whole map with saved changes as a PDF at map scale, on the smallest A paper it fits.",
  working: "Making PDF …",
  ready: (size: string | undefined, landscape: boolean, widthMm: number, heightMm: number) =>
    `The PDF is ready (${size ? `${size} ${landscape ? "landscape" : "portrait"}` : `${widthMm} × ${heightMm} mm`}).`,
  open: "Open the PDF",
  unsaved: "Changes that are not saved yet are not included.",
  busy: "Too many map jobs are running. Try again in a moment.",
  failed: (error: string) => `The PDF could not be made: ${error}`,
  slow: "The PDF is taking longer than expected. Try again in a moment."
};
