import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const compose = readFileSync(path.join(repoRoot, "docker-compose.prod.yml"), "utf8");

/** Raderna för en tjänst i docker-compose.prod.yml (från `  namn:` till nästa tjänst på samma nivå). */
function serviceBlock(name: string): string {
  const match = new RegExp(`^  ${name}:[^\\n]*\\n((?:(?:    |\\s*#)[^\\n]*\\n|\\n)*)`, "m").exec(compose);
  if (!match) throw new Error(`Hittar inte tjänsten ${name}`);
  return match[1]!;
}

describe("webbens hälsokontroll i docker-compose.prod.yml", () => {
  it("web frågar /api/health var 30:e sekund med starttid, inte en hel sida var 5:e", () => {
    const web = serviceBlock("web");
    expect(web).toContain("healthcheck: &web-healthcheck");
    expect(web).toContain("fetch('http://127.0.0.1:3000/api/health')");
    expect(web).toMatch(/^ {6}interval: 30s$/m);
    expect(web).toMatch(/^ {6}timeout: 5s$/m);
    expect(web).toMatch(/^ {6}start_period: 120s$/m);
    expect(web).toMatch(/^ {6}retries: 10$/m);
  });

  it("publikens instanser använder samma kontroll", () => {
    expect(serviceBlock("web-public")).toMatch(/^ {4}healthcheck: \*web-healthcheck$/m);
    expect(compose).toMatch(/^ {2}web-public2: \*web-public$/m);
  });

  it("ingen hälsokontroll renderar en sida (/organizer, /om)", () => {
    expect(compose).not.toMatch(/fetch\('http:\/\/127\.0\.0\.1:3000\/(organizer|om)'\)/);
  });

  it("/api/health kräver ingen inloggning och kör bara hälsofrågan", () => {
    const route = readFileSync(path.join(repoRoot, "apps/web/src/app/api/health/route.ts"), "utf8");
    expect(route).toMatch(/import \{ readHealth \} from "@o-tid\/application"/);
    expect(route).not.toMatch(/session|requireRaceAdmin|cookies\(/i);
  });
});
