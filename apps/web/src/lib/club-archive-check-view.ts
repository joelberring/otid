import type { ClubMapCheckView } from "@o-tid/contracts";
import { clubArchiveChecksSv } from "../i18n/club-archive-checks-sv";
import type { Texts } from "./language";
import { clubBase } from "./club-request";

type ChecksTexts = Texts<typeof clubArchiveChecksSv>;

/** Kort etikett till statusmärket: "Fungerar · OCAD 11.2", "OCAD 7 stöds inte", "Filen är skadad" … */
export function checkLabel(check: ClubMapCheckView | null, text: ChecksTexts = clubArchiveChecksSv): string {
  if (!check) return text.notChecked;
  if (check.status === "OK") return text.works(check.fileVersion);
  if (check.status === "UNSUPPORTED_VERSION" && check.detail) return check.detail.split(/\.\s/)[0]!.replace(/\.$/, "");
  return text.status[check.status];
}

/** Hela förklaringen (title och text under märket). */
export function checkExplanation(check: ClubMapCheckView | null, text: ChecksTexts = clubArchiveChecksSv): string {
  if (!check || check.status === "OK") return "";
  return check.detail ?? text.explain[check.status];
}

const thumbnailUrl = (clubId: string, path: string, stamp: string) => `${clubBase(clubId)}/${path}?v=${encodeURIComponent(stamp)}`;
export const mapThumbnailUrl = (clubId: string, versionId: string, checkedAt: string) => thumbnailUrl(clubId, `map-versions/${versionId}/check`, checkedAt);
export const entryThumbnailUrl = (clubId: string, entryId: string, createdAt: string) => thumbnailUrl(clubId, `archive/${entryId}/thumbnail`, createdAt);
