export async function prepareCheckinShell(scriptUrl: string): Promise<string> {
  if (!window.isSecureContext || !("serviceWorker" in navigator)) throw new Error("Offline shell unavailable");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      navigator.serviceWorker.register("/checkin/sw.js", { scope: "/checkin/", updateViaCache: "none" }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Offline shell unavailable")), 15_000); })
    ]);
  } finally { clearTimeout(timer); }
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    let requested = false;
    const finish = (version?: string) => {
      clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener("controllerchange", request);
      channel.port1.close(); channel.port2.close();
      if (version) resolve(version); else reject(new Error("Offline shell unavailable"));
    };
    const request = () => {
      const controller = navigator.serviceWorker.controller;
      if (!controller || requested) return;
      requested = true;
      controller.postMessage("CHECKIN_SHELL_STATUS", [channel.port2]);
    };
    const timeout = setTimeout(() => finish(), 15_000);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const value = event.data;
      if (!value || typeof value !== "object") { finish(); return; }
      const data = value as Record<string, unknown>;
      if (data.kind !== "CHECKIN_SHELL_STATUS" || data.complete !== true || typeof data.version !== "string" ||
          !/^[0-9a-f]{64}$/.test(data.version) || !Array.isArray(data.assets) || !data.assets.includes(scriptUrl)) { finish(); return; }
      finish(data.version);
    };
    navigator.serviceWorker.addEventListener("controllerchange", request);
    request();
  });
}
