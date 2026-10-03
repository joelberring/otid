import { createServer } from "node:http";

// Isolated test origin only: serves no files, APIs, credentials or private data.
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end("<!doctype html><html lang='sv'><title>Isolerat IndexedDB-prov</title><body>Browserlagringsprov</body></html>");
});
server.listen(3102, "127.0.0.1");
