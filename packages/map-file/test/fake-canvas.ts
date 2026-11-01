import type { MapCanvasContext } from "../src";

/** En falsk canvas som spelar in anropen och de egenskaper som sätts. */
export type Call = { op: string; args: unknown[]; state: Record<string, unknown> };
export function fakeContext(width = 400, height = 300) {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {};
  const stack: Record<string, unknown>[] = [];
  const record = (op: string) => (...args: unknown[]) => { calls.push({ op, args, state: { ...state } }); };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, key: string) {
      if (key === "canvas") return { width, height };
      if (key === "save") return () => { stack.push({ ...state }); calls.push({ op: "save", args: [], state: { ...state } }); };
      if (key === "restore") return () => { Object.assign(state, stack.pop() ?? {}); calls.push({ op: "restore", args: [], state: { ...state } }); };
      if (key === "setLineDash") return (dash: number[]) => { state.lineDash = dash; };
      if (key in state) return state[key];
      return record(key);
    },
    set(_target, key: string, value) { state[key] = value; return true; }
  };
  return { ctx: new Proxy({}, handler) as unknown as MapCanvasContext, calls };
}

