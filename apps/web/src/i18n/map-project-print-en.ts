import type { Texts } from "../lib/language";
import type { mapProjectPrintSv } from "./map-project-print-sv";

export const mapProjectPrintEn: Texts<typeof mapProjectPrintSv> = {
  button: "Print PDF",
  help: "The whole map with saved changes and the map's real colours as a PDF at map scale, on the smallest A paper it fits.",
  options: "PDF settings",
  optionsHelp: "The PDF uses the map's real colours by default.",
  lightenOffice: "Office lightening (+30 % green / +15 % yellow)",
  lightenOfficeHelp: "Lightens green and yellow areas for office printers that print too dark.",
  pressMode: "Press PDF",
  pressModeHelp: "Keeps the map file's spot colours and overprint for a print shop.",
  working: "Making PDF …",
  ready: (size: string | undefined, landscape: boolean, widthMm: number, heightMm: number) =>
    `The PDF is ready (${size ? `${size} ${landscape ? "landscape" : "portrait"}` : `${widthMm} × ${heightMm} mm`}).`,
  open: "Open the PDF",
  unsaved: "Changes that are not saved yet are not included.",
  busy: "Too many map jobs are running. Try again in a moment.",
  failed: (error: string) => `The PDF could not be made: ${error}`,
  slow: "The PDF is taking longer than expected. Try again in a moment."
};
