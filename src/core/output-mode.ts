/** Decide whether a data command should emit JSON or human output. */

export type OutputMode = "json" | "human" | "conflict";

export interface OutputModeInput {
  isTTY: boolean;
  args: readonly string[];
  env: Record<string, string | undefined>;
}

export function resolveOutputMode({ isTTY, args, env }: OutputModeInput): OutputMode {
  const wantsJson = args.includes("--json");
  const wantsHuman = args.includes("--human");
  if (wantsJson && wantsHuman) return "conflict";
  if (wantsHuman) return "human";
  if (wantsJson) return "json";
  if (env.FORA_JSON === "1") return "json";
  if (env.FORA_JSON === "0") return "human";
  return isTTY ? "human" : "json";
}
