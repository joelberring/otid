"use client";

import { accountBenefitsSv } from "../i18n/account-benefits-sv";
import { accountBenefitsEn } from "../i18n/account-benefits-en";
import { useTexts } from "./language-provider";
import styles from "./organizer-workspace.module.css";

/** Ägaren 2026-11-22: vad ett konto ger, bredvid inloggningen och registreringen (under formuläret i mobilen). */
export function AccountBenefits() {
  const text = useTexts(accountBenefitsSv, accountBenefitsEn);
  return <aside className={`${styles.panel} ${styles.benefits}`} aria-labelledby="account-benefits-title" data-testid="account-benefits">
    <h2 id="account-benefits-title">{text.title}</h2>
    <p><strong>{text.free}</strong> {text.freeText}</p>
    <ul>{text.items.map(item => <li key={item}>{item}</li>)}</ul>
    <h3>{text.promisesTitle}</h3>
    <ul>{text.promises.map(item => <li key={item}>{item}</li>)}</ul>
    <p className={styles.benefitsTip}>{text.eventorTip}</p>
    <p className={styles.muted}>{text.noAccount}</p>
  </aside>;
}
