export type PublicLinkShareData = { title: string; url: string };

export type PublicLinkShareBrowser = {
  origin: string;
  share?: (data: PublicLinkShareData) => Promise<void>;
  copy?: (url: string) => Promise<void>;
};

export type PublicLinkShareResult = "SHARED" | "SHARE_UNAVAILABLE" | "SHARE_CANCELLED" | "COPIED" | "COPY_UNAVAILABLE";

/** Turns an already-known public path into an absolute same-origin URL. */
export function publicLinkUrl(origin: string, path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("PUBLIC_LINK_PATH_INVALID");
  const url = new URL(path, origin);
  if (url.origin !== new URL(origin).origin) throw new Error("PUBLIC_LINK_PATH_INVALID");
  return url.toString();
}

export async function sharePublicLink(browser: PublicLinkShareBrowser, path: string, title: string): Promise<PublicLinkShareResult> {
  if (browser.share === undefined) return "SHARE_UNAVAILABLE";
  try {
    await browser.share({ title, url: publicLinkUrl(browser.origin, path) });
    return "SHARED";
  } catch {
    return "SHARE_CANCELLED";
  }
}

export async function copyPublicLink(browser: PublicLinkShareBrowser, path: string): Promise<PublicLinkShareResult> {
  if (browser.copy === undefined) return "COPY_UNAVAILABLE";
  try {
    await browser.copy(publicLinkUrl(browser.origin, path));
    return "COPIED";
  } catch {
    return "COPY_UNAVAILABLE";
  }
}
