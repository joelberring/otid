import { useState } from "react";
import { createRoot } from "react-dom/client";
import { prepareCheckinShell } from "./shell-access";
import { CheckinPreparation } from "./preparation";
import { checkinText as t } from "./text-sv";
import "./shell.css";

// This entry point is built without Next/RSC; only these public assets may be cached.
const scriptUrl = (document.currentScript as HTMLScriptElement | null)?.src ?? "";
function CheckinShell() {
  const [status, setStatus] = useState<string>(t.shellMissing);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const prepare = async () => {
    setBusy(true);
    try { setStatus(`${t.shellReady} ${(await prepareCheckinShell(scriptUrl)).slice(0, 12)}`); setReady(true); }
    catch { setStatus(t.shellFailed); setReady(false); }
    finally { setBusy(false); }
  };
  return <main><h1>{t.title}</h1><p>{t.subtitle}</p>
    <p role="status" aria-label={t.shellLabel}>{status}</p><button disabled={busy} onClick={() => { void prepare(); }}>{t.prepareShell}</button>
    <CheckinPreparation shellReady={ready} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<CheckinShell />);
