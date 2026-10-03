"use client";

import React, { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  pairingAdminGrantRevokeResponseSchema,
  pairingAdminLoginRequestSchema,
  pairingAdminLoginResponseSchema
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import {
  clearPairingGrantMaterial,
  createPairingGrantMaterial,
  pairingGrantIssueBody,
  pairingGrantToken,
  parsePairingGrantIssue,
  parsePairingGrantList,
  readPairingAdminCsrf,
  type CredentialLifetimeHours,
  type PairingGrantMaterial,
  type PairingGrantMetadata,
  type PairingGrantStatus
} from "../lib/pairing-admin-client";

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : sv.pairingUnknownError;
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error(sv.pairingInvalidResponse);
  }
}

const statusPresentation: Record<PairingGrantStatus, { symbol: string; text: string; className: string }> = {
  ACTIVE: { symbol: "●", text: sv.pairingStatusActive, className: "pairing-active" },
  REDEEMED: { symbol: "✓", text: sv.pairingStatusRedeemed, className: "pairing-redeemed" },
  REVOKED: { symbol: "⊘", text: sv.pairingStatusRevoked, className: "pairing-revoked" },
  EXPIRED: { symbol: "◷", text: sv.pairingStatusExpired, className: "pairing-expired" }
};

export function PairingAdmin({ raceId }: { raceId: string }) {
  const [accessCredential, setAccessCredential] = useState("");
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [grants, setGrants] = useState<PairingGrantMetadata[]>([]);
  const [credentialLifetimeHours, setCredentialLifetimeHours] = useState<CredentialLifetimeHours>(24);
  const [pendingIssue, setPendingIssue] = useState<PairingGrantMaterial>();
  const [issuedToken, setIssuedToken] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>(sv.pairingCheckingSession);
  const grantsUrl = `/api/admin/races/${raceId}/pairing-grants`;
  const sessionUrl = `/api/admin/races/${raceId}/pairing-session`;

  const loadGrants = useCallback(async () => {
    const response = await fetch(grantsUrl, { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401) {
      setAuthenticated(false);
      setGrants([]);
      setMessage(sv.pairingLoginRequired);
      return false;
    }
    if (!response.ok) throw new Error(`${sv.pairingListFailed} (${response.status})`);
    setGrants(parsePairingGrantList(await responseJson(response), raceId));
    setAuthenticated(true);
    setMessage("");
    return true;
  }, [grantsUrl, raceId]);

  useEffect(() => {
    void loadGrants().catch((error: unknown) => {
      setAuthenticated(false);
      setMessage(messageFrom(error));
    });
  }, [loadGrants]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(sv.pairingLoggingIn);
    try {
      const parsedLogin = pairingAdminLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential });
      if (!parsedLogin.success) throw new Error(sv.pairingLoginRejected);
      const response = await fetch(sessionUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsedLogin.data)
      });
      if (!response.ok) throw new Error(response.status === 401 ? sv.pairingLoginRejected : `${sv.pairingLoginFailed} (${response.status})`);
      const parsedResponse = pairingAdminLoginResponseSchema.safeParse(await responseJson(response));
      if (!parsedResponse.success) throw new Error(sv.pairingInvalidResponse);
      const loginResponse = parsedResponse.data;
      if (loginResponse.raceId !== raceId) throw new Error(sv.pairingWrongRace);
      setAccessCredential("");
      await loadGrants();
    } catch (error) {
      setMessage(messageFrom(error));
    } finally {
      setAccessCredential("");
      setBusy(false);
    }
  }

  async function submitIssue(material: PairingGrantMaterial) {
    setBusy(true);
    setMessage(sv.pairingIssuing);
    try {
      const response = await fetch(grantsUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `pairing-grant:${material.grantId}`,
          "x-otid-csrf": readPairingAdminCsrf(document.cookie, new URL(window.location.href))
        },
        body: JSON.stringify(pairingGrantIssueBody(material))
      });
      if (!response.ok) {
        if (response.status === 409) {
          clearPairingGrantMaterial(material);
          setPendingIssue(undefined);
          setMessage(sv.pairingIssueConflict);
          return;
        }
        if (response.status === 401) setAuthenticated(false);
        throw new Error(`${sv.pairingIssueFailed} (${response.status})`);
      }
      const issued = parsePairingGrantIssue(await responseJson(response), material, raceId);
      const token = pairingGrantToken(material);
      clearPairingGrantMaterial(material);
      setPendingIssue(undefined);
      setIssuedToken(token);
      const successMessage = issued.status === "duplicate" ? sv.pairingDuplicateRecovered : sv.pairingIssued;
      setMessage(successMessage);
      try {
        await loadGrants();
        setMessage(successMessage);
      } catch {
        setMessage(`${successMessage} ${sv.pairingListFailed}.`);
      }
    } catch (error) {
      setMessage(`${messageFrom(error)} ${sv.pairingRetryExplanation}`);
    } finally {
      setBusy(false);
    }
  }

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIssuedToken(undefined);
    try {
      const material = await createPairingGrantMaterial(credentialLifetimeHours);
      setPendingIssue(material);
      await submitIssue(material);
    } catch (error) {
      setMessage(messageFrom(error));
    }
  }

  async function revoke(grant: PairingGrantMetadata) {
    if (!window.confirm(sv.pairingRevokeConfirm)) return;
    setBusy(true);
    try {
      const response = await fetch(`${grantsUrl}/${grant.grantId}/revoke`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-otid-csrf": readPairingAdminCsrf(document.cookie, new URL(window.location.href)) }
      });
      if (!response.ok) throw new Error(`${sv.pairingRevokeFailed} (${response.status})`);
      const parsedRevoked = pairingAdminGrantRevokeResponseSchema.safeParse(await responseJson(response));
      if (!parsedRevoked.success) throw new Error(sv.pairingInvalidResponse);
      const revoked = parsedRevoked.data;
      if (revoked.grant.grantId !== grant.grantId || revoked.grant.raceId !== raceId || revoked.grant.revokedAt === null) {
        throw new Error(sv.pairingInvalidResponse);
      }
      setMessage(sv.pairingRevoked);
      await loadGrants();
    } catch (error) {
      setMessage(messageFrom(error));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      const response = await fetch(sessionUrl, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "x-otid-csrf": readPairingAdminCsrf(document.cookie, new URL(window.location.href)) }
      });
      if (!response.ok && response.status !== 401) throw new Error(`${sv.pairingLogoutFailed} (${response.status})`);
      if (pendingIssue !== undefined) clearPairingGrantMaterial(pendingIssue);
      setPendingIssue(undefined);
      setIssuedToken(undefined);
      setGrants([]);
      setAuthenticated(false);
      setMessage(sv.pairingLoggedOut);
    } catch (error) {
      setMessage(messageFrom(error));
    } finally {
      setBusy(false);
    }
  }

  async function copyToken() {
    if (issuedToken === undefined) return;
    try {
      await navigator.clipboard.writeText(issuedToken);
      setMessage(sv.pairingCopied);
    } catch {
      setMessage(sv.pairingCopyFailed);
    }
  }

  return <div className="stack pairing-admin">
    <section className="panel pairing-security-note" aria-labelledby="pairing-security-heading">
      <h2 id="pairing-security-heading">{sv.pairingSecurityHeading}</h2>
      <p>{sv.pairingSecurityBoundary}</p>
    </section>

    {authenticated !== true && <form className="panel stack" onSubmit={(event) => void login(event)}>
      <h2>{sv.pairingLoginHeading}</h2>
      <p className="muted">{sv.pairingLoginHelp}</p>
      <label>{sv.pairingAccessCredential}
        <input type="password" autoComplete="off" spellCheck={false} value={accessCredential}
          onChange={(event) => setAccessCredential(event.target.value)} required />
      </label>
      <button type="submit" disabled={busy || accessCredential.length === 0} aria-busy={busy}>{sv.pairingLogin}</button>
    </form>}

    {authenticated === true && <>
      <section className="panel stack" aria-labelledby="pairing-issue-heading">
        <h2 id="pairing-issue-heading">{sv.pairingIssueHeading}</h2>
        <p>{sv.pairingIssueHelp}</p>
        <form className="stack" onSubmit={(event) => void issue(event)}>
          <label>{sv.pairingCredentialLifetime}
            <select value={credentialLifetimeHours} onChange={(event) => setCredentialLifetimeHours(Number(event.target.value) as CredentialLifetimeHours)}>
              <option value={8}>8 timmar</option><option value={24}>24 timmar</option><option value={72}>72 timmar</option>
            </select>
          </label>
          <button type="submit" disabled={busy || pendingIssue !== undefined} aria-busy={busy}>{sv.pairingIssue}</button>
        </form>
        {pendingIssue !== undefined && <div className="pairing-retry" role="alert">
          <strong>△ {sv.pairingUnknownCommit}</strong>
          <p>{sv.pairingUnknownCommitHelp}</p>
          <button type="button" className="secondary" disabled={busy} onClick={() => void submitIssue(pendingIssue)}>
            {sv.pairingRetrySame}
          </button>
        </div>}
      </section>

      {issuedToken !== undefined && <section className="panel pairing-token" aria-labelledby="pairing-token-heading">
        <h2 id="pairing-token-heading">{sv.pairingTokenHeading}</h2>
        <p><strong>⚠ {sv.pairingTokenOnce}</strong></p>
        <output className="pairing-token-value" aria-label={sv.pairingTokenLabel}>{issuedToken}</output>
        <div className="pairing-actions">
          <button type="button" onClick={() => void copyToken()}>{sv.pairingCopy}</button>
          <button type="button" className="secondary" onClick={() => setIssuedToken(undefined)}>{sv.pairingClear}</button>
        </div>
      </section>}

      <section className="panel stack" aria-labelledby="pairing-list-heading">
        <div className="pairing-list-heading"><div><h2 id="pairing-list-heading">{sv.pairingListHeading}</h2>
          <p className="muted">{sv.pairingListHelp}</p></div>
          <div className="pairing-actions"><button type="button" className="secondary" disabled={busy} onClick={() => void loadGrants()}>{sv.pairingRefresh}</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => void logout()}>{sv.pairingLogout}</button></div>
        </div>
        <p className="pairing-revocation-note"><strong>Obs:</strong> {sv.pairingRedeemedMeaning}</p>
        <div className="pairing-grant-list">
          {grants.map((grant) => {
            const presentation = statusPresentation[grant.status];
            return <article className="pairing-grant" key={grant.grantId}>
              <div><strong className={presentation.className}>{presentation.symbol} {presentation.text}</strong>
                <span className="pairing-grant-id">{grant.grantId}</span>
                <span>{sv.pairingExpires}: {new Date(grant.expiresAt).toLocaleString("sv-SE")}</span>
                <span>{sv.pairingCredentialExpires}: {new Date(grant.credentialExpiresAt).toLocaleString("sv-SE")}</span></div>
              {grant.status === "ACTIVE" && <button type="button" className="secondary danger" disabled={busy}
                onClick={() => void revoke(grant)}>{sv.pairingRevoke}</button>}
            </article>;
          })}
          {grants.length === 0 && <p className="muted">{sv.pairingNoGrants}</p>}
        </div>
      </section>
    </>}
    <p className="pairing-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
