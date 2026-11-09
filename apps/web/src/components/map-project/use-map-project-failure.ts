import { useCallback } from "react";
import { mapProjectEn } from "../../i18n/map-project-en";
import { mapProjectSv } from "../../i18n/map-project-sv";
import { mapProjectFailure } from "../../lib/map-project-client";
import { useTexts } from "../language-provider";

/** Engelska del 33: kartprojektens felbesked på sidans språk. */
export function useMapProjectFailure(): (status: number) => string {
  const errors = useTexts(mapProjectSv.errors, mapProjectEn.errors);
  return useCallback((status: number) => mapProjectFailure(status, errors), [errors]);
}
