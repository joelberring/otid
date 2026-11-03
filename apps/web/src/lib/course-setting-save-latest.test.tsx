import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { saveOnLatest, serialSaves, type SaveAttempt } from "./course-setting-save-latest";
import { SaveFailed } from "../components/course-setting/save-failed";

vi.mock("../components/ui", () => ({
  Button: ({ children, onClick, disabled }: React.ButtonHTMLAttributes<HTMLButtonElement>) => React.createElement("button", { onClick, disabled }, children)
}));
vi.mock("../components/course-setting/save-failed.module.css", () => ({ default: { line: "line" } }));

/** Servern med en version; `attempt` lyckas bara på den senaste, och `others` sparar emellan (konflikt). */
function server(options: { others?: number; reject?: boolean } = {}) {
  let version = 3;
  let others = options.others ?? 0;
  const calls: number[] = [];
  return {
    calls,
    get version() { return version; },
    save: {
      latest: async () => version,
      attempt: async (base: number): Promise<SaveAttempt> => {
        calls.push(base);
        if (others > 0) { others -= 1; version += 1; }
        if (options.reject) return "rejected";
        if (base !== version) return "conflict";
        version += 1;
        return "saved";
      }
    }
  };
}

describe("sparande på senaste versionen (banläggningen utanför editorn)", () => {
  it("sparar direkt när ingen annan sparat", async () => {
    const s = server();
    expect(await saveOnLatest(s.save)).toEqual({ saved: true });
    expect(s.calls).toEqual([3]);
  });

  it("konflikt: läser om och försöker en gång till, tyst", async () => {
    const s = server({ others: 1 });
    expect(await saveOnLatest(s.save)).toEqual({ saved: true });
    expect(s.calls).toEqual([3, 4]);
    expect(s.version).toBe(5);
  });

  it("konflikt två gånger: inte sparat, och beskedet visas", async () => {
    const s = server({ others: 2 });
    expect(await saveOnLatest(s.save)).toEqual({ saved: false, reason: "conflict" });
    expect(s.calls).toEqual([3, 4]);
  });

  it("avvisat (inte versionen): inget nytt försök", async () => {
    const s = server({ reject: true });
    expect(await saveOnLatest(s.save)).toEqual({ saved: false, reason: "rejected" });
    expect(s.calls).toEqual([3]);
  });

  it("nätet: ett fel blir inte sparat, utan nytt försök", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await saveOnLatest({ latest: async () => 1, attempt: async () => { throw new Error("nät"); } });
    expect(result).toEqual({ saved: false, reason: "failed" });
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it("ett i taget: nästa börjar när det förra är klart, också efter ett fel", async () => {
    const order: string[] = [];
    const run = serialSaves();
    const first = run(async () => { await new Promise(resolve => setTimeout(resolve, 10)); order.push("första"); throw new Error("fel"); });
    const second = run(async () => { order.push("andra"); return 2; });
    await expect(first).rejects.toThrow("fel");
    expect(await second).toBe(2);
    expect(order).toEqual(["första", "andra"]);
  });

  it("beskedet: en rad vid det som inte sparades, med Försök igen", () => {
    const html = renderToStaticMarkup(React.createElement(SaveFailed, { onRetry: () => undefined }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Ändringen sparades inte – försök igen.");
    expect(html).toContain("<button>Försök igen</button>");
  });
});
