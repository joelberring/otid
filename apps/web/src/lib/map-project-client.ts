import { mapProjectSv } from "../i18n/map-project-sv";

/** ADR-0219: kartprojektens anrop från webbläsaren (samma skydd som klubbens, `clubRequest`). */
export const mapProjectsBase = "/api/organizer/map-projects";
export const mapProjectBase = (projectId: string) => `${mapProjectsBase}/${encodeURIComponent(projectId)}`;

export function mapProjectFailure(status: number): string {
  const errors = mapProjectSv.errors;
  if (status === 401) return errors.session;
  if (status === 400) return errors.invalid;
  if (status === 403) return errors.forbidden;
  if (status === 404) return errors.notFound;
  if (status === 409) return errors.conflict;
  return errors.generic(status);
}
