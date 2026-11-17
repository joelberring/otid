import type { Texts } from "../lib/language";
import type { racePrintFilesSv } from "./race-print-files-sv";

export const racePrintFilesEn: Texts<typeof racePrintFilesSv> = {
  heading: "Saved prints",
  help: "PDFs saved here are kept (the print jobs above are cleared after a week). Everyone who sees the course setting can download them, also someone with a task in the term plan.",
  none: "No saved prints yet.",
  upload: "Upload a PDF",
  uploading: "Uploading …",
  download: "Download",
  remove: "Remove",
  removeConfirm: name => `Remove ${name} from the saved prints?`,
  saveJob: "Save the print",
  savedJob: "Saved under Saved prints.",
  fromJob: "from PDF for print",
  size: megabytes => `${megabytes} MB`,
  by: name => `by ${name}`,
  failed: "That did not work. Try again.",
  tooLarge: megabytes => `The PDF is too large (at most ${megabytes} MB).`,
  notPdf: "The file is not a PDF.",
  tooMany: "There are already as many saved prints as allowed (30). Remove one first."
};
