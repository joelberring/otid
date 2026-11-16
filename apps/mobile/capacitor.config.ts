import type { CapacitorConfig } from "@capacitor/cli";

// Appen är ett skal runt O-Tids webb (ADR-0227). Adressen läses när `cap sync` körs och byggs in i appen.
const serverUrl = parseServerUrl(process.env.OTID_APP_SERVER_URL ?? "https://otid.berring.se");

function parseServerUrl(value: string): URL {
  const url = new URL(value);
  // Capacitor använder adressen som ursprung för bryggan; en sökväg gör att bryggan inte kopplas in på Android.
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`OTID_APP_SERVER_URL ska vara bara schema och värd (t.ex. https://otid.berring.se), inte ${value}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`OTID_APP_SERVER_URL ska börja med https:// eller http://, inte ${value}`);
  }
  return url;
}

const config: CapacitorConfig = {
  appId: "se.berring.otid",
  appName: "O-Tid",
  webDir: "www",
  server: {
    // Bara den här värden öppnas i appen. Utan `allowNavigation` öppnar Capacitor alla andra adresser i telefonens
    // webbläsare (Bridge.launchIntent på Android, WebViewDelegationHandler på iOS).
    url: serverUrl.origin,
    // Reservsidan visas när servern inte nås.
    errorPath: "index.html",
    // Okrypterat bara för provkörning mot en lokal server.
    cleartext: serverUrl.protocol === "http:"
  },
  // Sidan börjar under klockan och kameran i stället för bakom dem (webben har ingen egen marginal för det).
  ios: { contentInset: "always" }
};

export default config;
