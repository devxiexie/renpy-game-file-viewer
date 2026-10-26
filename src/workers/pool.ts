import * as Comlink from "comlink";
import type * as Engine from "./engine";
import type { EngineApi } from "./client";

const pool: EngineApi[] = [];

/** Extra engine workers for embarrassingly parallel jobs (image recompression). */
export function enginePool(): EngineApi[] {
  if (pool.length === 0) {
    const n = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2)));
    for (let i = 0; i < n; i++) {
      pool.push(Comlink.wrap<typeof Engine>(new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module", name: `engine-${i}` })));
    }
  }
  return pool;
}
