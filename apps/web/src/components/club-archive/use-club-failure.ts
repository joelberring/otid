import { useCallback } from "react";
import { clubArchiveEn } from "../../i18n/club-archive-en";
import { clubArchiveSv } from "../../i18n/club-archive-sv";
import { clubFailure } from "../../lib/club-archive-client";
import { useTexts } from "../language-provider";

/** Engelska del 34: klubbarkivets felbesked på sidans språk. */
export function useClubFailure(): (status: number) => string {
  const errors = useTexts(clubArchiveSv.errors, clubArchiveEn.errors);
  return useCallback((status: number) => clubFailure(status, errors), [errors]);
}
