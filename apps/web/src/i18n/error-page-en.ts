import type { Texts } from "../lib/language";
import type { errorPageSv } from "./error-page-sv";

/** The error pages: something unexpected went wrong in the browser. */
export const errorPageEn: Texts<typeof errorPageSv> = {
  title: "Something went wrong",
  body: "The page could not be shown. What you have already saved is still there. Try again, or go back to the start page.",
  retry: "Try again",
  home: "To the start page",
  code: (digest: string) => `Error code: ${digest}`
};
