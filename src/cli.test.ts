import { describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";

const cwd = new URL("..", import.meta.url).pathname;

async function run(...args: string[]) {
  const proc = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return { out, err, code: proc.exitCode };
}

describe("agent-friendly help", () => {
  it("adds concise prose and copy-pasteable examples to command help", async () => {
    const { out } = await run("hot", "--help");
    expect(out).toContain("USAGE fora hot");
    expect(out).toContain("Examples:");
    expect(out).toContain("fora hot --site v2ex");
    expect(out).toContain("Failures from --site all are reported on stderr");
    expect(out).not.toContain("NOTES FOR AGENTS");
  });

  it("supports `fora help <command>` with the full nested usage prefix", async () => {
    const { out } = await run("help", "sites", "add");
    expect(out).toContain("USAGE fora sites add");
    expect(out).toContain("Examples:");
    expect(out).toContain("fora sites add https://linux.do --yes");
  });

  it("documents JSON errors and exit codes at the root", async () => {
    const { out } = await run("--help");
    expect(out).toContain("Exit codes: 0=ok, 1=generic, 2=usage, 3=unsupported, 4=rate-limited.");
    expect(out).toContain("fora help hot");
    expect(out).toContain("Examples:");
    expect(out).not.toContain("ABOUT\n");
  });

  it("shows help for bare parent commands instead of a terse error", async () => {
    for (const command of ["sites", "engines"]) {
      const { out, err, code } = await run(command);
      expect(code, command).toBe(0);
      expect(out, command).toContain(`USAGE fora ${command}`);
      expect(out, command).toContain("Examples:");
      expect(err, command).toBe("");
    }
  });

  it("suggests the closest command for an unknown help target", async () => {
    const { err, code } = await run("help", "hoт");
    expect(code).toBe(2);
    expect(err).toContain("Did you mean:");
    expect(err).toContain("fora hot");
  });

  it("suggests subcommands within the right parent", async () => {
    for (const [args, expected] of [
      [["sites", "lis"], "fora sites list"],
      [["engines", "lis"], "fora engines list"],
      [["sites", "lis", "--help"], "fora sites list"],
      [["help", "sites", "lis"], "fora sites list"],
    ] as const) {
      const { err, code } = await run(...args);
      expect(code, args.join(" ")).toBe(2);
      expect(err, args.join(" ")).toContain(expected);
      expect(err, args.join(" ")).not.toContain("fora hot");
    }
  });

  it("rejects flags that are missing their value, including JSON mode", async () => {
    const { err, code } = await run("hot", "--limit", "--json");
    expect(code).toBe(2);
    const parsed = JSON.parse(err.trim());
    expect(parsed.code).toBe("usage");
    expect(parsed.message).toContain("--limit requires a value");
    expect(parsed.message).toContain("fora hot --limit 20");
  });

  it("does not create files when a value flag is missing", async () => {
    const dir = join(cwd, "fora-adapter-missing-value-probe");
    await rm(dir, { recursive: true, force: true });
    const { err, code } = await run("create-adapter", "missing-value-probe", "--dir");
    expect(code).toBe(2);
    expect(err).toContain("--dir requires a value");
    expect(await Bun.file(dir).exists()).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  it("resolves help targets when flags carry inline values", async () => {
    const { out } = await run("--site=v2ex", "hot", "--help");
    expect(out).toContain("USAGE fora hot");
  });

  it("keeps every help page free of duplicated lines and hints", async () => {
    const paths: string[][] = [
      [],
      ["hot"],
      ["latest"],
      ["show"],
      ["search"],
      ["categories"],
      ["digest"],
      ["sites"],
      ["sites", "list"],
      ["sites", "search"],
      ["sites", "add"],
      ["sites", "remove"],
      ["engines"],
      ["engines", "list"],
      ["doctor"],
      ["create-adapter"],
    ];

    for (const path of paths) {
      const label = path.join(" ") || "(root)";
      const { out } = await run(...path, "--help");
      expect(out, label).toContain("Examples:");
      expect(out, label).not.toContain("NOTES FOR AGENTS");
      expect(out, label).not.toContain("\nABOUT\n");

      const lines = out.split("\n").map((line) => line.trim()).filter(Boolean);
      expect(new Set(lines).size, label).toBe(lines.length);
      expect(out.split("--help").length - 1, label).toBeLessThanOrEqual(1);
    }
  });
});
