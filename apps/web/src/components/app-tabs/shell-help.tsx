"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { HelpViews } from "../help/help-dialog";
import { HelpButton } from "../help/help-panel";

/** Hjälpen som sidan har om den inte säger något själv (sökvägen). */
export function shellHelpView(pathname: string): HelpViews {
  if (/^\/organizer\/map-projects(\/|$)/.test(pathname)) return "MAP_EDITOR";
  if (/^\/organizer\/clubs\/[^/]+\/arkiv\//.test(pathname)) return ["ARCHIVE_ENTRY", "ARCHIVE_MAPS"];
  if (/^\/organizer\/clubs\//.test(pathname)) return "ARCHIVE_TRAININGS";
  return "EVENTS";
}

type ShellHelp = { view: HelpViews | undefined; setView: (view: HelpViews | undefined) => void };
const ShellHelpContext = createContext<ShellHelp | undefined>(undefined);

/** Steg F1: skalets Hjälp (vänstermenyn och telefonens sidhuvud) öppnar sidans artiklar. */
export function ShellHelpProvider({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState<HelpViews | undefined>();
  return <ShellHelpContext.Provider value={{ view, setView }}>{children}</ShellHelpContext.Provider>;
}

/**
 * En sida vars hjälp beror på mer än sökvägen (klubbsidans flikar) säger vilka artiklar som står först. Utanför skalet (en
 * utloggad besökare) gör den ingenting.
 */
export function useShellHelp(view: HelpViews): void {
  const setView = useContext(ShellHelpContext)?.setView;
  const key = JSON.stringify(view);
  useEffect(() => {
    if (!setView) return;
    setView(JSON.parse(key) as HelpViews);
    return () => setView(undefined);
  }, [setView, key]);
}

export function ShellHelpButton({ pathname, compact = false }: { pathname: string; compact?: boolean }) {
  const view = useContext(ShellHelpContext)?.view;
  return <HelpButton view={view ?? shellHelpView(pathname)} compact={compact} />;
}
