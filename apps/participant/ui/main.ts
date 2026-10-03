import {
  getGpsStatus, resumeGps, startGps, stopGps, type GpsStatus
} from "../src/gps-plugin";
import { describeStatus } from "./status-view";
import { sv } from "./sv";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`UI-element saknas: ${id}`);
  return found as T;
}

const card = element<HTMLElement>("state-card");
const title = element<HTMLElement>("state-title");
const detail = element<HTMLElement>("state-detail");
const count = element<HTMLElement>("point-count");
const lastFix = element<HTMLElement>("last-fix");
const recordingId = element<HTMLElement>("recording-id");
const network = element<HTMLElement>("network-state");
const message = element<HTMLElement>("operation-message");
const startButton = element<HTMLButtonElement>("start-button");
const resumeButton = element<HTMLButtonElement>("resume-button");
const stopButton = element<HTMLButtonElement>("stop-button");
const refreshButton = element<HTMLButtonElement>("refresh-button");

let busy = false;
let refreshSerial = 0;

function applyStaticCopy(): void {
  document.title = sv.static.pageTitle;
  for (const [id, copy] of [
    ["eyebrow", sv.static.eyebrow], ["page-title", sv.static.heading],
    ["lead", sv.static.lead], ["state-label", sv.static.stateLabel],
    ["point-label", sv.static.pointLabel], ["last-fix-label", sv.static.lastFixLabel],
    ["recording-label", sv.static.recordingLabel], ["network-label", sv.static.networkLabel],
    ["privacy-title", sv.static.privacyTitle], ["privacy-detail", sv.static.privacyDetail],
    ["footer", sv.static.footer]
  ] as const) element<HTMLElement>(id).textContent = copy;
  element<HTMLElement>("facts").setAttribute("aria-label", sv.static.factsLabel);
  title.textContent = sv.static.loadingTitle;
  detail.textContent = sv.static.loadingDetail;
  startButton.textContent = sv.static.startAction;
  resumeButton.textContent = sv.static.resumeAction;
  stopButton.textContent = sv.static.stopAction;
  refreshButton.textContent = sv.static.refreshAction;
}

function renderNetwork(): void {
  network.textContent = navigator.onLine ? sv.networkOnline : sv.networkOffline;
}

function render(status: GpsStatus): void {
  const view = describeStatus(status);
  card.dataset.tone = view.tone;
  title.textContent = view.title;
  detail.textContent = view.detail;
  count.textContent = String(status.pointCount);
  lastFix.textContent = status.lastMeasuredAtMs === null
    ? sv.noMeasurement
    : new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "medium" }).format(status.lastMeasuredAtMs);
  recordingId.textContent = status.recordingId === null
    ? sv.noVersion
    : `${sv.localVersionPrefix}${status.recordingId.slice(0, 8)}`;
  startButton.hidden = !view.canStart;
  resumeButton.hidden = !view.canResume;
  stopButton.hidden = !view.canStop;
  for (const button of [startButton, resumeButton, stopButton, refreshButton]) {
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
  }
}

function renderReadFailure(): void {
  card.dataset.tone = "error";
  title.textContent = sv.state.SERVICE_ERROR.title;
  detail.textContent = sv.statusFailed;
  count.textContent = "–";
  lastFix.textContent = "–";
  recordingId.textContent = "–";
  for (const button of [startButton, resumeButton, stopButton]) button.hidden = true;
  refreshButton.disabled = false;
  message.textContent = sv.statusFailed;
}

async function refresh(): Promise<void> {
  if (busy) return;
  const current = ++refreshSerial;
  try {
    const status = await getGpsStatus();
    if (current === refreshSerial) {
      render(status);
      message.textContent = "";
    }
  } catch {
    if (current === refreshSerial) renderReadFailure();
  }
}

async function act(operation: () => Promise<GpsStatus>): Promise<void> {
  if (busy) return;
  busy = true;
  refreshSerial += 1;
  for (const button of [startButton, resumeButton, stopButton, refreshButton]) button.disabled = true;
  message.textContent = sv.actionPending;
  try {
    const status = await operation();
    busy = false;
    render(status);
    message.textContent = "";
    if (status.state === "STARTING" || status.state === "STOPPING") window.setTimeout(() => { void refresh(); }, 500);
  } catch {
    busy = false;
    renderReadFailure();
    message.textContent = sv.actionFailed;
  }
}

startButton.addEventListener("click", () => { void act(startGps); });
resumeButton.addEventListener("click", () => { void act(resumeGps); });
stopButton.addEventListener("click", () => { void act(stopGps); });
refreshButton.addEventListener("click", () => { void refresh(); });
window.addEventListener("online", renderNetwork);
window.addEventListener("offline", renderNetwork);
document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
window.setInterval(() => { if (!document.hidden) void refresh(); }, 2_000);

applyStaticCopy();
renderNetwork();
void refresh();
