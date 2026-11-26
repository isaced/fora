import { describe, expect, it } from "bun:test";
import { resolveOutputMode, type OutputMode } from "./output-mode.ts";

const cases: Array<{
  label: string;
  isTTY: boolean;
  args: string[];
  env?: Record<string, string>;
  expected: OutputMode;
}> = [
  { label: "tty defaults to human", isTTY: true, args: [], expected: "human" },
  { label: "pipe defaults to json", isTTY: false, args: [], expected: "json" },
  { label: "explicit json", isTTY: true, args: ["--json"], expected: "json" },
  { label: "explicit human", isTTY: false, args: ["--human"], expected: "human" },
  { label: "human beats pipe", isTTY: false, args: ["--human"], expected: "human" },
  { label: "json beats tty", isTTY: true, args: ["--json"], expected: "json" },
  { label: "env forces json", isTTY: true, args: [], env: { FORA_JSON: "1" }, expected: "json" },
  { label: "env forces human", isTTY: false, args: [], env: { FORA_JSON: "0" }, expected: "human" },
  { label: "explicit wins over env", isTTY: false, args: ["--human"], env: { FORA_JSON: "1" }, expected: "human" },
  { label: "conflict", isTTY: false, args: ["--json", "--human"], expected: "conflict" },
];

describe("resolveOutputMode", () => {
  for (const testCase of cases) {
    it(testCase.label, () => {
      expect(resolveOutputMode({
        isTTY: testCase.isTTY,
        args: testCase.args,
        env: { FORA_JSON: undefined, ...testCase.env },
      })).toBe(testCase.expected);
    });
  }
});
