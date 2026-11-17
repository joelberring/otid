"use client";

import { useEffect, useState } from "react";
import type { MapSourceCredentialView } from "@o-tid/contracts";
import { lantmaterietEn } from "../i18n/lantmateriet-en";
import { lantmaterietSv } from "../i18n/lantmateriet-sv";
import { accountRequest } from "../lib/account-client";
import { LANTMATERIET_ACCOUNT_HREF, LANTMATERIET_HELP_ARTICLE, lantmaterietLink, type LantmaterietProblem, type LantmaterietProduct }
  from "../lib/lantmateriet-status";
import { HelpLink } from "./help/help-panel";
import { useTexts } from "./language-provider";
import styles from "./lantmateriet-connection.module.css";

/**
 * Kontots uppgifter till Lantmäteriet (bara vad som är sparat, aldrig uppgifterna), läst en gång med det befintliga anropet;
 * undefined tills svaret kommit, och när `enabled` är falskt (då frågas inte servern).
 */
export function useLantmaterietCredential(enabled = true): MapSourceCredentialView | undefined {
  const [view, setView] = useState<MapSourceCredentialView>();
  useEffect(() => {
    if (!enabled) return;
    void accountRequest("/api/account/map-sources/lantmateriet").then(result => {
      if (result.status === 200) setView(result.json as MapSourceCredentialView);
    }, () => undefined);
  }, [enabled]);
  return view;
}

/** «Så kopplar du Lantmäteriet» (hjälpartikeln) och «Mitt konto» (där uppgifterna läggs in). */
function Links({ account = true }: { account?: boolean }) {
  const text = useTexts(lantmaterietSv, lantmaterietEn);
  return <span className={styles.links}>
    <HelpLink article={LANTMATERIET_HELP_ARTICLE} label={text.howTo} />
    {account && <a href={LANTMATERIET_ACCOUNT_HREF} data-testid="lantmateriet-account-link">{text.account}</a>}
  </span>;
}

/**
 * Översynen av första kartan 2026-11-17: det lugna beskedet när en hämtning från Lantmäteriet inte kan gå eller nekades. Inget
 * rött: «inte kopplat än» är ett väntat läge för en ny användare. Säger vilket fall det är och vad man gör, med länkarna.
 */
export function LantmaterietNotice({ problem, product }: { problem: LantmaterietProblem; product: LantmaterietProduct }) {
  const text = useTexts(lantmaterietSv, lantmaterietEn);
  return <div className={styles.notice} role="status" data-testid="lantmateriet-notice" data-problem={problem}>
    <p>{problem === "rejected" ? text.problems.rejected[product] : text.problems[problem]}</p>
    <Links account={problem !== "server"} />
  </div>;
}

/** En rad om kopplingen innan man trycker (guidens första delsteg, projektsidans Nästa steg); inget medan läget läses. */
export function LantmaterietStatus({ view }: { view: MapSourceCredentialView | undefined }) {
  const text = useTexts(lantmaterietSv, lantmaterietEn);
  const link = lantmaterietLink(view);
  if (link === "unknown") return null;
  return <p className={styles.status} data-testid="lantmateriet-status" data-link={link}>
    {text.needs} <strong>{text.status[link]}</strong>{link !== "connected" && <> <Links account={link !== "server"} /></>}
  </p>;
}

/** Produkterna att beställa på Geotorget: vad var och en används till och om den behövs för första kartan. */
export function LantmaterietProducts() {
  const text = useTexts(lantmaterietSv, lantmaterietEn).products;
  return <div className={styles.products} data-testid="lantmateriet-products">
    <h3>{text.heading}</h3>
    <p className={styles.muted}>{text.help}</p>
    <table>
      <thead><tr><th scope="col">{text.columns.product}</th><th scope="col">{text.columns.use}</th><th scope="col">{text.columns.first}</th></tr></thead>
      <tbody>{text.rows.map(row => <tr key={row.product} data-first={row.first}>
        <th scope="row">{row.product}</th><td>{row.use}</td><td data-label={text.columns.first}>{row.first ? <strong>{text.needed}</strong> : text.optional}</td>
      </tr>)}</tbody>
    </table>
    <Links account={false} />
  </div>;
}
