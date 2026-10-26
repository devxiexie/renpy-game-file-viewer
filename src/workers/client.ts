import * as Comlink from "comlink";
import type * as Engine from "./engine";

export type EngineApi = Comlink.Remote<typeof Engine>;

let instance: EngineApi | null = null;

/** Shared engine worker (lazily created). */
export function engine(): EngineApi {
  if (!instance) {
    const worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module", name: "engine" });
    instance = Comlink.wrap<typeof Engine>(worker);
  }
  return instance;
}

export { Comlink };
