import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Falsk SMTP-server för webbläsartesterna (ADR-0172). Webben skickar återställningsmejl hit med vanlig
 * SMTP via `OTID_SMTP_URL` (samma kod som i drift, ingen särskild testväg i appen). Varje mottaget
 * meddelande sparas som JSON i `E2E_MAIL_DIR` så att testerna kan läsa länken. Bara för test.
 */
export const FAKE_SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? 4325);
export const FAKE_SMTP_DIR = process.env.E2E_MAIL_DIR ?? join(tmpdir(), "otid-e2e-mail");

export function startFakeSmtp(port = FAKE_SMTP_PORT, directory = FAKE_SMTP_DIR): Promise<Server> {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  let counter = 0;
  const server = createServer((socket) => {
    let buffer = "";
    let recipients: string[] = [];
    let data: string[] | undefined;
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply("220 fake-smtp O-Tid test");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index: number;
      while ((index = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (data) {
          if (line === ".") {
            counter += 1;
            writeFileSync(join(directory, `${Date.now()}-${process.pid}-${counter}.json`),
              JSON.stringify({ to: recipients, raw: data.join("\r\n") }));
            data = undefined;
            recipients = [];
            reply("250 OK");
          } else data.push(line.startsWith("..") ? line.slice(1) : line);
          continue;
        }
        const command = line.slice(0, 4).toUpperCase();
        if (command === "EHLO") { reply("250-fake-smtp"); reply("250 8BITMIME"); }
        else if (command === "RCPT") { recipients.push(/<([^>]*)>/.exec(line)?.[1]?.toLowerCase() ?? ""); reply("250 OK"); }
        else if (command === "DATA") { data = []; reply("354 Skicka meddelandet"); }
        else if (command === "QUIT") { reply("221 Hej då"); socket.end(); }
        else if (["HELO", "MAIL", "RSET", "NOOP"].includes(command)) reply("250 OK");
        else reply("502 Stöds inte");
      }
    });
    socket.on("error", () => socket.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve(server));
  });
}

function decodeBody(raw: string): string {
  const split = raw.indexOf("\r\n\r\n");
  const headers = raw.slice(0, split).toLowerCase();
  const body = raw.slice(split + 4);
  if (/content-transfer-encoding:\s*base64/.test(headers)) return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  if (/content-transfer-encoding:\s*quoted-printable/.test(headers)) {
    const bytes = body.replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/gi, (_match, hex: string) => `%${hex}`);
    return decodeURIComponent(bytes.replace(/%(?![0-9A-F]{2})/gi, "%25"));
  }
  return body;
}

/** Senaste mejlet till adressen (texten avkodad), eller undefined. */
export function latestMailTo(address: string, directory = FAKE_SMTP_DIR): { text: string; raw: string } | undefined {
  const files = readdirSync(directory).filter((file) => file.endsWith(".json")).sort();
  for (const file of files.reverse()) {
    const mail = JSON.parse(readFileSync(join(directory, file), "utf8")) as { to: string[]; raw: string };
    if (mail.to.includes(address.toLowerCase())) return { text: decodeBody(mail.raw), raw: mail.raw };
  }
  return undefined;
}
