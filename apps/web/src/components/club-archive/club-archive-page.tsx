"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ClubArchiveList, ClubView } from "@o-tid/contracts";
import { clubArchiveSv } from "../../i18n/club-archive-sv";
import type { HelpView } from "../../i18n/help-sv";
import { clubBase, clubRequest } from "../../lib/club-archive-client";
import { Notice } from "../ui";
import { ArchiveList } from "./archive-list";
import { ClubImportPanel } from "./club-import-panel";
import { ClubMapsPanel } from "./club-maps-panel";
import { ClubDevicesPanel } from "./club-devices-panel";
import { ClubMembersPanel } from "./club-members-panel";
import { useArchiveChecks } from "./use-archive-checks";
import { ClubSpacePanel, type ClubSpaceFocus } from "../club-affiliation/club-space-panel";
import { ClubStartCard, type ClubStartTarget } from "./club-start-card";
import { clubAffiliationSv } from "../../i18n/club-affiliation-sv";
import { HelpButton } from "../help/help-panel";
import { AccountMenu } from "../account-menu";
import styles from "./club-archive.module.css";

const text = clubArchiveSv;
type Tab = "trainings" | "maps" | "members" | "devices" | "club" | "import";
const TABS: readonly Tab[] = ["trainings", "maps", "members", "devices", "club", "import"];
const TAB_HELP: Record<Tab, HelpView> = { trainings: "ARCHIVE_TRAININGS", maps: "ARCHIVE_MAPS", members: "ARCHIVE_MEMBERS", devices: "ARCHIVE_MEMBERS", club: "ARCHIVE_CLUB",
  import: "ARCHIVE_IMPORT" };

function initialTab(): Tab {
  if (typeof window === "undefined") return "trainings";
  const hash = window.location.hash.slice(1);
  return (TABS as readonly string[]).includes(hash) ? hash as Tab : "trainings";
}

/**
 * ADR-0194: klubbarkivet (`/organizer/clubs/[clubId]`). Flikarna Träningar (sök och filter), Kartor (versioner, rättigheter,
 * slå ihop och dela, ny version), Medlemmar och Import (nyckeln och kommandot). Aldrig publikt; behörigheten avgörs av API:et.
 */
export function ClubArchivePage({ clubId }: { clubId: string }) {
  const [list, setList] = useState<ClubArchiveList>();
  const [club, setClub] = useState<ClubView>();
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("trainings");
  const [focus, setFocus] = useState<ClubSpaceFocus>();
  const tabs = useRef<HTMLDivElement>(null);
  useEffect(() => { setTab(initialTab()); }, []);

  const load = useCallback(async () => {
    const [archive, view] = await Promise.all([clubRequest(`${clubBase(clubId)}/archive`), clubRequest(clubBase(clubId))]);
    if (archive.status !== 200 || view.status !== 200) { setFailed(true); return; }
    setFailed(false);
    setList(archive.json as ClubArchiveList);
    setClub(view.json as ClubView);
  }, [clubId]);
  useEffect(() => { void load(); }, [load]);

  const choose = (next: Tab) => {
    setTab(next);
    try { window.history.replaceState(null, "", `#${next}`); } catch { /* adressen är bara en bekvämlighet */ }
  };
  /** Kom igång: en flik, eller en ruta under Klubben (kopplingen eller Vem ser vad), som rullas fram när den är hämtad. */
  const go = (target: ClubStartTarget) => {
    if (target === "eventor" || target === "access") {
      choose("club");
      setFocus(current => ({ target, seq: (current?.seq ?? 0) + 1 }));
      return;
    }
    choose(target);
    tabs.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const admin = club ? club.viewer.role === "OWNER" || club.viewer.role === "ADMIN" : false;
  // ADR-0196: kartornas kontroll och bilderna ritas i bakgrunden när en medlem som får se arkivet och hämta kartfilerna
  // (kartbanken) har arkivet öppet (ändrat 2026-11-07; förut bara administratörer).
  const checks = useArchiveChecks(clubId, list, admin || Boolean(list?.viewer.access.archive && list.viewer.access.mapBank), load);
  const usage = useMemo(() => club ? text.usage(club.usage.mapBytes + club.usage.courseFileBytes, club.usage.maps, club.usage.versions,
    club.usage.entries) : "", [club]);

  if (failed) return <main className={styles.page}><p className={styles.kicker}><Link href="/organizer">{text.back}</Link></p>
    <Notice tone="error" role="alert">{text.loadFailed}</Notice></main>;
  if (!list || !club) return <main className={styles.page}><p role="status">{text.loading}</p></main>;
  return <main className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className={styles.kicker}><Link href="/organizer">{text.back}</Link> · {text.title}</p>
        <h1>{list.clubName}</h1>
        {/* ADR-0209 beslut D: en klubbyta utan Eventor-nyckel är inte bevisad. */}
        <p className={styles.muted} data-testid="club-eventor-badge">{club.eventorClub ? clubAffiliationSv.space.linkedBadge(club.eventorClub)
          : clubAffiliationSv.space.unlinked}</p>
      </div>
      <div className={styles.headSide}>
        <p className={styles.usage} data-testid="club-usage">{usage}</p>
        {/* Hjälp (grenen hjalp-banlaggning): flikens artiklar först. */}
        <HelpButton view={[TAB_HELP[tab], "ARCHIVE_TRAININGS"]} />
        <AccountMenu />
      </div>
    </header>
    <ClubStartCard club={club} clubName={list.clubName} onGo={go} />
    <div ref={tabs} className={styles.tabs} role="tablist" aria-label={text.title}>
      {TABS.filter(name => admin || name !== "club").map(name => <button key={name} type="button" role="tab" id={`tab-${name}`} aria-selected={tab === name} aria-controls={`panel-${name}`}
        onClick={() => { setFocus(undefined); choose(name); }}>{text.tabs[name]}</button>)}
    </div>
    <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
      {tab === "trainings" && (list.viewer.access.archive ? <ArchiveList clubId={clubId} list={list} admin={admin} />
        : <Notice role="status">{clubAffiliationSv.space.archiveClosed}</Notice>)}
      {tab === "maps" && (list.viewer.access.archive ? <ClubMapsPanel clubId={clubId} maps={list.maps} admin={admin} mapBank={list.viewer.access.mapBank}
        onChanged={load} checks={checks} /> : <Notice role="status">{clubAffiliationSv.space.archiveClosed}</Notice>)}
      {tab === "members" && <ClubMembersPanel club={club} onChanged={load} />}
      {tab === "devices" && <ClubDevicesPanel clubId={clubId} />}
      {tab === "club" && admin && <ClubSpacePanel clubId={clubId} clubName={list.clubName} focus={focus} onInvite={() => choose("members")}
        onChanged={load} />}
      {tab === "import" && <ClubImportPanel club={club} onChanged={load} />}
    </div>
  </main>;
}
