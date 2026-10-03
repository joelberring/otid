import type { EvaluationResult } from "@o-tid/domain";
import { evaluateAndPersistSimulatorReadout } from "../src/local-evaluation";
import { readStationOperationalStatus, type StationOperationalStatus } from "../src/operational-status";
import { normalizeServerBaseUrl } from "../src/server-url";
import { installDownloadedStationPackage } from "../src/station-package-client";
import {
  beginStationPairing,
  discardInvalidStationPairing,
  discardStationPairing,
  redeemStationPairing
} from "../src/station-pairing";
import { OtidStationStore } from "../src/station-store-plugin";
import { StationSyncCoordinator } from "../src/station-sync";

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`UI-element saknas: ${id}`);
  return element as T;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "Ett okänt fel inträffade";
}

function setBusy(button: HTMLButtonElement, busy: boolean): void {
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
}

function parseControlCodes(value: string): number[] {
  if (value.trim() === "") return [];
  const codes = value.split(",").map((part) => Number(part.trim()));
  if (codes.some((code) => !Number.isSafeInteger(code) || code <= 0)) {
    throw new Error("Kontrollkoder måste vara positiva heltal separerade med komma");
  }
  if (codes.length > 256) throw new Error("Högst 256 kontrollstämplingar stöds");
  return codes;
}

function isoFromLocalInput(value: string, label: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} är ogiltig`);
  return date.toISOString();
}

function simulatorPunches(codes: readonly number[], startIso: string, finishIso: string) {
  const start = Date.parse(startIso);
  const finish = Date.parse(finishIso);
  if (finish <= start) throw new Error("Måltiden måste vara efter starttiden");
  return codes.map((code, index) => ({
    code,
    punchedAt: new Date(start + ((finish - start) * (index + 1)) / (codes.length + 1)).toISOString()
  }));
}

const reasonText: Record<EvaluationResult["reason"], string> = {
  COMPLETE: "Alla obligatoriska kontroller finns i rätt ordning.",
  UNKNOWN_CARD: "Bricknumret finns inte i det aktiva tävlingspaketet.",
  MISSING_START: "Startstämpling saknas.",
  MISSING_FINISH: "Målstämpling saknas.",
  MISSING_CONTROL: "En eller flera obligatoriska kontroller saknas.",
  WRONG_ORDER: "Kontrollerna är stämplade i fel ordning.",
  INVALID_TIME_ORDER: "Tidsordningen mellan stämplingarna är ogiltig."
};

function renderResult(evaluation: EvaluationResult, sequence?: number): void {
  const panel = requiredElement<HTMLElement>("result-panel");
  panel.className = `result-panel ${evaluation.status === "OK" ? "ok" : evaluation.status === "MP" ? "mp" : "unknown"}`;
  requiredElement("result-code").textContent = evaluation.status === "UNKNOWN_CARD" ? "OKÄND BRICKA" : evaluation.status;
  const additions = [
    evaluation.missingControls.length > 0 ? `Saknas: ${evaluation.missingControls.join(", ")}.` : "",
    evaluation.extraPunches.length > 0 ? `Extra: ${evaluation.extraPunches.join(", ")}.` : "",
    sequence === undefined ? "" : `Lokal sekvens ${sequence}.`
  ].filter(Boolean).join(" ");
  requiredElement("result-detail").textContent = `${reasonText[evaluation.reason]}${additions === "" ? "" : ` ${additions}`}`;
}

function renderStatus(status: StationOperationalStatus): void {
  const networkCard = requiredElement<HTMLElement>("network-card");
  networkCard.className = `status-card ${status.online ? "ok" : "warning"}`;
  requiredElement("network-status").textContent = status.online ? "Nätverk tillgängligt" : "Offline · lokal drift fortsätter";
  const packageCard = requiredElement<HTMLElement>("package-card");
  if (status.packageState.kind === "ready") {
    selectedRaceId = status.packageState.raceId;
    requiredElement<HTMLInputElement>("race-id").value = status.packageState.raceId;
    packageCard.className = "status-card ok";
    requiredElement("package-status").textContent = `Verifierat · version ${status.packageState.packageVersion}`;
  } else if (status.packageState.kind === "incompatible") {
    selectedRaceId = status.packageState.raceId;
    requiredElement<HTMLInputElement>("race-id").value = status.packageState.raceId;
    packageCard.className = "status-card error";
    requiredElement("package-status").textContent = `Motorversion ${status.packageState.packageEngineVersion} är inte kompatibel`;
  } else {
    packageCard.className = "status-card warning";
    requiredElement("package-status").textContent = "Inget aktivt paket valt";
  }
  requiredElement("readout-count").textContent = String(status.readoutCount);
  requiredElement("acknowledged-count").textContent = String(status.acknowledgedCount);
  requiredElement("rejected-count").textContent = String(status.rejectedCount);
  requiredElement("pending-count").textContent = String(status.pendingCount);
  requiredElement("device-id").textContent = `Enhet: ${status.deviceId}`;
  currentDeviceId = status.deviceId;
  const credentialCard = requiredElement<HTMLElement>("credential-card");
  switch (status.credentialState.state) {
    case "active":
      credentialCard.className = "status-card ok";
      requiredElement("credential-status").textContent = status.credentialState.credential.raceId === selectedRaceId
        ? `Aktiv · generation ${status.credentialState.credential.generation}`
        : `Aktiv för annat lopp · generation ${status.credentialState.credential.generation}`;
      break;
    case "expired":
      credentialCard.className = "status-card error";
      requiredElement("credential-status").textContent = "Utgången · ny parning krävs";
      break;
    case "invalid":
      credentialCard.className = "status-card error";
      requiredElement("credential-status").textContent = "Ogiltig eller oläsbar · ny parning krävs";
      break;
    case "missing":
      credentialCard.className = "status-card warning";
      requiredElement("credential-status").textContent = "Saknas · parning krävs";
      break;
  }
  const pairingCard = requiredElement<HTMLElement>("pairing-card");
  const resumeButton = requiredElement<HTMLButtonElement>("pairing-resume-button");
  const discardButton = requiredElement<HTMLButtonElement>("pairing-discard-button");
  const discardInvalidButton = requiredElement<HTMLButtonElement>("pairing-discard-invalid-button");
  resumeButton.hidden = true;
  discardButton.hidden = true;
  discardInvalidButton.hidden = true;
  currentPairingAttemptId = undefined;
  switch (status.pairingState.state) {
    case "none":
      pairingCard.className = "status-card warning";
      requiredElement("pairing-status").textContent = status.credentialState.state === "active"
        ? "Ingen parning pågår"
        : "Parning krävs";
      break;
    case "pending":
      pairingCard.className = "status-card warning";
      currentPairingAttemptId = status.pairingState.attempt.attemptId;
      requiredElement("pairing-status").textContent = "Beständigt försök väntar · återuppta uttryckligen";
      resumeButton.hidden = false;
      discardButton.hidden = false;
      break;
    case "completed":
      pairingCard.className = "status-card ok";
      currentPairingAttemptId = status.pairingState.attemptId;
      requiredElement("pairing-status").textContent = `Lyckad · generation ${status.pairingState.credential.generation}`;
      if (selectedRaceId === undefined) {
        requiredElement<HTMLInputElement>("race-id").value = status.pairingState.credential.raceId;
      }
      break;
    case "invalid":
      pairingCard.className = "status-card error";
      requiredElement("pairing-status").textContent = "Oläsbart försök · uttrycklig rensning krävs";
      discardInvalidButton.hidden = false;
      break;
  }
  const comparison = requiredElement<HTMLElement>("central-comparison");
  const syncBadge = requiredElement("sync-badge");
  const central = status.centralSync;
  if (central.latestContactAtEpochMs === null) {
    requiredElement("server-status").textContent = "Ingen verifierad kontakt";
  } else {
    const packageText = central.packageVersionStatus === "stale"
      ? ` · lokalt paket inaktuellt, serverversion ${central.currentPackageVersion ?? "?"}`
      : central.packageVersionStatus === "ahead"
        ? ` · lokal paketversion ligger före server ${central.currentPackageVersion ?? "?"}`
        : central.currentPackageVersion === null ? "" : ` · paket ${central.currentPackageVersion}`;
    requiredElement("server-status").textContent = `Kontakt ${new Date(central.latestContactAtEpochMs).toLocaleTimeString("sv-SE")}${packageText}`;
  }
  comparison.className = "comparison-text";
  switch (central.comparison.kind) {
    case "none":
      comparison.textContent = "Inget lokalt eller centralt besked finns för valt lopp.";
      syncBadge.textContent = "LOKAL KÖ";
      break;
    case "pending":
      comparison.classList.add("warning");
      comparison.textContent = `Sekvens ${central.comparison.localSequence} väntar lokalt och har ännu inget centralt besked.`;
      syncBadge.textContent = "VÄNTAR";
      break;
    case "rejected":
      comparison.classList.add("error");
      comparison.textContent = `Servern avvisade sekvens ${central.comparison.localSequence}: ${central.comparison.reason}.`;
      syncBadge.textContent = "AVVISAD";
      break;
    case "central-missing":
      comparison.classList.add("warning");
      comparison.textContent = `Sekvens ${central.comparison.localSequence} är kvitterad men central bedömningsdetalj saknas.`;
      syncBadge.textContent = "DETALJ SAKNAS";
      break;
    case "local-missing":
      comparison.classList.add("warning");
      comparison.textContent = `Servern bedömde sekvens ${central.comparison.localSequence} som ${central.comparison.serverResult.status}; lokal bedömning saknas.`;
      syncBadge.textContent = "SERVERN GÄLLER";
      break;
    case "version-divergence":
      comparison.classList.add("warning");
      comparison.textContent = `Lokalt och centralt besked för sekvens ${central.comparison.localSequence} bygger på olika motor- eller snapshotversion och är inte direkt jämförbara. Servern gäller.`;
      syncBadge.textContent = "ANNAN VERSION";
      break;
    case "match":
      comparison.classList.add("match");
      comparison.textContent = `Lokal och central full bedömning matchar för sekvens ${central.comparison.localSequence}. Servern gäller.`;
      syncBadge.textContent = "MATCHAR";
      break;
    case "different":
      comparison.classList.add("error");
      comparison.textContent = `Lokal och central bedömning skiljer sig för sekvens ${central.comparison.localSequence}. Serverns ${central.comparison.serverResult.status} är auktoritativt.`;
      syncBadge.textContent = "AVVIKELSE";
      break;
  }
  if (status.latestLocalEvaluation !== null) {
    renderResult(status.latestLocalEvaluation.evaluation, status.latestLocalEvaluation.localSequence);
  } else {
    requiredElement<HTMLElement>("result-panel").className = "result-panel neutral";
    requiredElement("result-code").textContent = "Ingen bedömning";
    requiredElement("result-detail").textContent = "Ingen beständig lokal bedömning finns för den senaste avläsningen i valt lopp.";
  }
}

let selectedRaceId: string | undefined;
let configuredBaseUrl: string | undefined;
let syncCoordinator: StationSyncCoordinator | undefined;
let currentDeviceId: string | undefined;
let currentPairingAttemptId: string | undefined;
function newUuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] ?? 0) & 0x0f | 0x40;
  bytes[8] = (bytes[8] ?? 0) & 0x3f | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const sessionId = newUuid();

async function refreshStatus(): Promise<void> {
  const error = requiredElement<HTMLElement>("status-error");
  try {
    const status = await readStationOperationalStatus({
      online: navigator.onLine,
      ...(selectedRaceId === undefined ? {} : { raceId: selectedRaceId })
    });
    renderStatus(status);
    error.hidden = true;
  } catch (caught) {
    error.textContent = `Statusfel: ${messageFrom(caught)}`;
    error.hidden = false;
  }
}

async function configureBaseUrl(value: string): Promise<string> {
  const normalized = normalizeServerBaseUrl(value);
  const saved = await OtidStationStore.saveBaseUrl({ baseUrl: normalized });
  if (saved.baseUrl !== normalized) throw new Error("Stationslagret gav en annan serveradress än den sparade");
  configuredBaseUrl = normalized;
  syncCoordinator = new StationSyncCoordinator({ baseUrl: normalized });
  requiredElement<HTMLInputElement>("base-url").value = normalized;
  return normalized;
}

async function syncAndRefresh(manual: boolean): Promise<void> {
  const button = requiredElement<HTMLButtonElement>("sync-button");
  const message = requiredElement<HTMLElement>("sync-message");
  if (manual) setBusy(button, true);
  try {
    if (!navigator.onLine) throw new Error("Stationen är offline; kön ligger säkert kvar lokalt");
    const typedBaseUrl = requiredElement<HTMLInputElement>("base-url").value.trim();
    if (syncCoordinator === undefined || (typedBaseUrl !== "" && normalizeServerBaseUrl(typedBaseUrl) !== configuredBaseUrl)) {
      if (typedBaseUrl === "") throw new Error("Ange serveradress innan synkning");
      await configureBaseUrl(typedBaseUrl);
    }
    const result = await syncCoordinator?.flush();
    if (result === undefined) throw new Error("Serveradress saknas");
    message.className = "message";
    message.textContent = result.processedCount === 0
      ? "Den lokala kön är tom."
      : `${result.processedCount} avläsning${result.processedCount === 1 ? "" : "ar"} behandlades. ${result.pendingCount} väntar lokalt.`;
  } catch (caught) {
    message.className = "message error";
    message.textContent = messageFrom(caught);
    if (manual) throw caught;
  } finally {
    await refreshStatus();
    if (manual) setBusy(button, false);
  }
}

requiredElement<HTMLButtonElement>("refresh-status").addEventListener("click", () => void refreshStatus());
requiredElement<HTMLButtonElement>("sync-button").addEventListener("click", () => {
  void syncAndRefresh(true).catch(() => undefined);
});
window.addEventListener("online", () => void syncAndRefresh(false));
window.addEventListener("offline", () => void refreshStatus());

requiredElement<HTMLFormElement>("pairing-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const button = requiredElement<HTMLButtonElement>("pairing-begin-button");
  const grantInput = requiredElement<HTMLInputElement>("pairing-grant");
  const message = requiredElement<HTMLElement>("pairing-message");
  void (async () => {
    setBusy(button, true);
    message.className = "message";
    try {
      const baseUrl = await configureBaseUrl(requiredElement<HTMLInputElement>("base-url").value.trim());
      const pairing = await beginStationPairing({ baseUrl, grantToken: grantInput.value });
      if (pairing.state === "completed") {
        selectedRaceId = pairing.credential.raceId;
        requiredElement<HTMLInputElement>("race-id").value = pairing.credential.raceId;
        message.textContent = "Grantet är redan säkert inlöst och credentialen är installerad.";
      } else if (pairing.state === "pending") {
        currentPairingAttemptId = pairing.attempt.attemptId;
        if (navigator.onLine) {
          const result = await redeemStationPairing(pairing.attempt.attemptId);
          selectedRaceId = result.credential.raceId;
          requiredElement<HTMLInputElement>("race-id").value = result.credential.raceId;
          message.textContent = result.status === "already-installed"
            ? "Credentialen var redan säkert installerad."
            : "Parningen lyckades och credentialen är säkert installerad.";
        } else {
          message.textContent = "Parningsförsöket är krypterat och beständigt. Lös in när nätverket är tillbaka.";
        }
      } else {
        throw new Error("Stationen skapade inget väntande parningsförsök");
      }
      await refreshStatus();
    } catch (caught) {
      message.className = "message error";
      message.textContent = `${messageFrom(caught)} Ett beständigt försök kan återupptas uttryckligen om begin hann lyckas.`;
      await refreshStatus();
    } finally {
      grantInput.value = "";
      setBusy(button, false);
    }
  })();
});

requiredElement<HTMLButtonElement>("pairing-resume-button").addEventListener("click", () => {
  const button = requiredElement<HTMLButtonElement>("pairing-resume-button");
  const message = requiredElement<HTMLElement>("pairing-message");
  void (async () => {
    setBusy(button, true);
    message.className = "message";
    try {
      if (!navigator.onLine) throw new Error("Stationen är offline; parningsförsöket ligger säkert kvar lokalt");
      const attemptId = currentPairingAttemptId;
      if (attemptId === undefined) throw new Error("Inget parningsförsök väntar");
      const result = await redeemStationPairing(attemptId);
      selectedRaceId = result.credential.raceId;
      requiredElement<HTMLInputElement>("race-id").value = result.credential.raceId;
      message.textContent = result.status === "already-installed"
        ? "Credentialen var redan säkert installerad."
        : "Parningen lyckades och credentialen är säkert installerad.";
      await refreshStatus();
    } catch (caught) {
      message.className = "message error";
      message.textContent = `${messageFrom(caught)} Det beständiga försöket ligger kvar för explicit återupptagning.`;
      await refreshStatus();
    } finally {
      setBusy(button, false);
    }
  })();
});

requiredElement<HTMLButtonElement>("pairing-discard-button").addEventListener("click", () => {
  const button = requiredElement<HTMLButtonElement>("pairing-discard-button");
  const message = requiredElement<HTMLElement>("pairing-message");
  void (async () => {
    setBusy(button, true);
    try {
      const attemptId = currentPairingAttemptId;
      if (attemptId === undefined) throw new Error("Inget läsbart parningsförsök väntar");
      await discardStationPairing(attemptId);
      message.className = "message";
      message.textContent = "Det väntande parningsförsöket kastades. Installerad credential och lokal kö ändrades inte.";
      await refreshStatus();
    } catch (caught) {
      message.className = "message error";
      message.textContent = messageFrom(caught);
    } finally {
      setBusy(button, false);
    }
  })();
});

requiredElement<HTMLButtonElement>("pairing-discard-invalid-button").addEventListener("click", () => {
  const button = requiredElement<HTMLButtonElement>("pairing-discard-invalid-button");
  const message = requiredElement<HTMLElement>("pairing-message");
  void (async () => {
    if (!window.confirm("Rensa det oläsbara parningsförsöket? Ett eventuellt serversvar kan inte återhämtas utan ett nytt grant.")) return;
    setBusy(button, true);
    try {
      if (currentDeviceId === undefined) throw new Error("Stationens enhets-id saknas");
      await discardInvalidStationPairing(currentDeviceId);
      message.className = "message";
      message.textContent = "Det oläsbara parningstillståndet rensades. Lokal kö och installerad credential ändrades inte.";
      await refreshStatus();
    } catch (caught) {
      message.className = "message error";
      message.textContent = messageFrom(caught);
    } finally {
      setBusy(button, false);
    }
  })();
});

requiredElement<HTMLFormElement>("package-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const button = requiredElement<HTMLButtonElement>("install-button");
  const message = requiredElement<HTMLElement>("package-message");
  void (async () => {
    setBusy(button, true);
    message.className = "message";
    try {
      const raceId = requiredElement<HTMLInputElement>("race-id").value.trim();
      const baseUrl = await configureBaseUrl(requiredElement<HTMLInputElement>("base-url").value.trim());
      const installed = await installDownloadedStationPackage({
        baseUrl,
        raceId,
        trustedPublicKeySpkiBase64: requiredElement<HTMLTextAreaElement>("trusted-spki").value.trim()
      });
      selectedRaceId = installed.raceId;
      requiredElement("server-status").textContent = `Kontakt ${new Date().toLocaleTimeString("sv-SE")}`;
      message.textContent = installed.status === "duplicate"
        ? `Paketversion ${installed.packageVersion} var redan säkert installerad.`
        : `Paketversion ${installed.packageVersion} är verifierad och aktiv.`;
      await refreshStatus();
    } catch (caught) {
      message.className = "message error";
      message.textContent = messageFrom(caught);
    } finally {
      setBusy(button, false);
    }
  })();
});

requiredElement<HTMLFormElement>("readout-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const button = requiredElement<HTMLButtonElement>("evaluate-button");
  void (async () => {
    setBusy(button, true);
    try {
      const raceId = selectedRaceId ?? requiredElement<HTMLInputElement>("race-id").value.trim();
      if (raceId === "") throw new Error("Installera eller ange ett aktivt lopp först");
      const startPunchedAt = isoFromLocalInput(requiredElement<HTMLInputElement>("start-time").value, "Starttiden");
      const finishPunchedAt = isoFromLocalInput(requiredElement<HTMLInputElement>("finish-time").value, "Måltiden");
      const punches = simulatorPunches(parseControlCodes(requiredElement<HTMLInputElement>("control-codes").value), startPunchedAt, finishPunchedAt);
      const outcome = await evaluateAndPersistSimulatorReadout({
        raceId,
        sessionId,
        simulatorPayload: {
          cardNumber: requiredElement<HTMLInputElement>("card-number").value,
          startPunchedAt,
          finishPunchedAt,
          punches
        }
      });
      selectedRaceId = raceId;
      if (outcome.kind === "evaluated") {
        await refreshStatus();
        renderResult(outcome.evaluation, outcome.event.localSequence);
      } else {
        await refreshStatus();
        requiredElement<HTMLElement>("result-panel").className = "result-panel error";
        requiredElement("result-code").textContent = "SPARAD · EJ BEDÖMD";
        requiredElement("result-detail").textContent = `Avläsningen finns i lokal kö, men paketets motor ${outcome.packageEngineVersion} matchar inte appens ${outcome.localEngineVersion}.`;
      }
      if (navigator.onLine && configuredBaseUrl !== undefined) void syncAndRefresh(false);
    } catch (caught) {
      await refreshStatus();
      requiredElement<HTMLElement>("result-panel").className = "result-panel error";
      requiredElement("result-code").textContent = "FEL";
      requiredElement("result-detail").textContent = messageFrom(caught);
    } finally {
      setBusy(button, false);
    }
  })();
});

function localDateTime(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 19);
}
const now = new Date();
requiredElement<HTMLInputElement>("start-time").value = localDateTime(new Date(now.getTime() - 20 * 60_000));
requiredElement<HTMLInputElement>("finish-time").value = localDateTime(now);
void (async () => {
  try {
    const stored = await OtidStationStore.loadBaseUrl();
    if (stored.baseUrl !== null) {
      configuredBaseUrl = normalizeServerBaseUrl(stored.baseUrl);
      syncCoordinator = new StationSyncCoordinator({ baseUrl: configuredBaseUrl });
      requiredElement<HTMLInputElement>("base-url").value = configuredBaseUrl;
    }
  } catch (caught) {
    const error = requiredElement<HTMLElement>("status-error");
    error.textContent = `Konfigurationsfel: ${messageFrom(caught)}`;
    error.hidden = false;
  }
  await refreshStatus();
  if (navigator.onLine && syncCoordinator !== undefined) await syncAndRefresh(false);
})();
