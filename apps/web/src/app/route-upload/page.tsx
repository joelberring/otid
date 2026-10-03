import { RouteUploadForm } from "../../components/route-upload-form";

export const dynamic = "force-dynamic";

/** Token-free shell. The private APIs, not the HTML, decide whether a session is active. */
export default function RouteUploadPage() {
  return <main className="public-page" aria-labelledby="route-upload-title">
    <h1 id="route-upload-title">Ladda upp din rutt</h1>
    <p>Välj din GPX-fil. Din uppladdningslänk visas inte här och lagras inte i webbläsaren.</p>
    <RouteUploadForm />
  </main>;
}
