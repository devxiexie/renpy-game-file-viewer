import { readRpyc, type RpycFile } from "./container";
import { decompileStatements, type DecompileOptions, type DecompileResult } from "./decompiler/decompiler";

export { readRpyc, RpycError } from "./container";
export type { RpycFile } from "./container";

export interface RpycDecompileResult extends DecompileResult {
  file: RpycFile;
  scriptVersion: number | null;
}

export function decompileRpyc(data: Uint8Array, options: DecompileOptions = {}): RpycDecompileResult {
  const file = readRpyc(data);
  const version = file.meta?.get("version");
  const result = decompileStatements(file.statements, options);
  return { ...result, file, scriptVersion: typeof version === "number" ? version : null };
}
