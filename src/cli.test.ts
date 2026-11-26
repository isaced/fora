import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cwd = new URL("..", import.meta.url).pathname;

function run(...args: string[]) {
  return runWithEnv(undefined, ...args);
}

async function runWithEnv(env: NodeJS.ProcessEnv | undefined, ...args: string[]) {
  const proc = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
    cwd,
    env,
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

async function withSiteFixtures(
  test: (runFixture: typeof run, origin: string, cachePath: string) => Promise<void>,
  follow = "limited",
) {
  const home = await mkdtemp(join(tmpdir(), "fora-cli-test-"));
  const feed = await Bun.file(new URL("./adapters/discourse-rss/fixtures/latest.xml", import.meta.url)).text();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/empty/")) return Response.json({ topic_list: { topics: [] } });
      if (url.pathname.startsWith("/limited/")) return new Response(null, { status: 429 });
      if (url.pathname === "/latest.rss") return new Response(feed.replaceAll("https://linux.do", url.origin));
      return new Response(null, { status: 404 });
    },
  });
  try {
    const origin = server.url.origin;
    await mkdir(join(home, "fora"));
    await Bun.write(join(home, "fora", "config.yaml"), [
      `follow: [${follow}]`,
      "sites:",
      "  - name: empty",
      "    engine: discourse",
      `    base_url: ${origin}/empty`,
      "  - name: limited",
      "    engine: discourse",
      `    base_url: ${origin}/limited`,
      "  - name: feed",
      "    engine: discourse-rss",
      `    base_url: ${origin}`,
      "",
    ].join("\n"));
    const env = {
      ...process.env, XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home, NO_PROXY: "127.0.0.1", no_proxy: "127.0.0.1",
    };
    await test((...args) => runWithEnv(env, ...args), origin, join(home, "fora", "last-list.json"));
  } finally {
    server.stop(true);
    await rm(home, { recursive: true, force: true });
  }
}

describe("cross-site results and topic references", () => {
  it("reports partial success even when the successful site has no topics", async () => {
    await withSiteFixtures(async (runFixture) => {
      const { out, err, code } = await runFixture("latest", "--site", "empty,limited,missing-site", "--json");
      expect(code).toBe(0);
      expect(err).toBe("");
      const result = JSON.parse(out);
      expect(result.data).toEqual([]);
      expect(result.meta.succeeded_sites).toEqual(["empty"]);
      expect(result.meta.failed_sites.map(({ site, code }: { site: string; code: string }) => [site, code])).toEqual([
        ["limited", "rate_limited"], ["missing-site", "usage"],
      ]);
    });
  });

  it("fails on stderr when every site fails, preserving a common error code", async () => {
    await withSiteFixtures(async (runFixture) => {
      for (const args of [["latest", "--site", "limited,missing-site"], ["digest", "--budget", "1"]]) {
        const { out, err, code } = await runFixture(...args, "--json");
        const mixed = args[0] === "latest";
        expect(code).toBe(mixed ? 1 : 4);
        expect(out).toBe("");
        expect(JSON.parse(err)).toMatchObject({
          code: mixed ? "generic" : "rate_limited",
          failed_sites: mixed
            ? [{ site: "limited", code: "rate_limited" }, { site: "missing-site", code: "usage" }]
            : [{ site: "limited", code: "rate_limited" }],
        });
      }
    });
  });

  it("keeps digest site outcomes even when the payload budget omits their groups", async () => {
    await withSiteFixtures(async (runFixture) => {
      const { out, err, code } = await runFixture("digest", "--budget", "1", "--json");
      expect(code).toBe(0);
      expect(err).toBe("");
      expect(JSON.parse(out)).toMatchObject({
        data: [],
        meta: {
          succeeded_sites: ["empty"],
          failed_sites: [{ site: "limited", code: "rate_limited" }],
          omitted_sites: ["empty", "limited"],
        },
      });
    }, "empty, limited");
  });

  it("opens a Discourse RSS list URL without an existing cache", async () => {
    await withSiteFixtures(async (runFixture, origin, cachePath) => {
      const list = await runFixture("latest", "feed", "-n", "1", "--json");
      expect(list.code).toBe(0);
      const [topic] = JSON.parse(list.out).data;
      expect(topic.url).toStartWith(origin);
      await rm(cachePath);
      const show = await runFixture("show", topic.url, "--json");
      expect(show.code).toBe(0);
      expect(JSON.parse(show.out).data.id).toBe(topic.id);
    });
  });
});

describe("agent-friendly help", () => {
  it("adds concise prose and copy-pasteable examples to command help", async () => {
    const { out } = await run("hot", "--help");
    expect(out).toContain("USAGE fora hot");
    expect(out).toContain("Examples:");
    expect(out).toContain("fora hot --site v2ex");
    expect(out).toContain("meta.failed_sites");
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

  it("reads command-specific value flags from their definitions", async () => {
    for (const [args, flag] of [
      [["digest", "--budget"], "--budget"],
      [["show", "linuxdo:12345", "--replies="], "--replies"],
    ] as const) {
      const { out, err, code } = await run(...args, "--json");
      expect(code).toBe(2);
      expect(out).toBe("");
      expect(JSON.parse(err)).toMatchObject({ code: "usage", message: expect.stringContaining(`${flag} requires a value`) });
    }
  });

  it("returns JSON for unknown help targets in both help forms", async () => {
    for (const args of [["help", "sites", "lis"], ["sites", "lis", "--help"]]) {
      const { out, err, code } = await run(...args, "--json");
      expect(code).toBe(2);
      expect(out).toBe("");
      expect(JSON.parse(err)).toMatchObject({ code: "usage", message: expect.stringContaining("fora sites list") });
    }
  });

  it("resolves help targets when flags carry inline values", async () => {
    const { out } = await run("--site=v2ex", "hot", "--help");
    expect(out).toContain("USAGE fora hot");
  });

  it("defaults data commands to JSON when stdout is piped", async () => {
    const { err, code } = await run("hot");
    expect(code).toBe(2);
    expect(() => JSON.parse(err.trim())).not.toThrow();
    expect(JSON.parse(err.trim()).code).toBe("usage");
  });

  it("can force human output with --human", async () => {
    const { err, code } = await run("hot", "--human");
    expect(code).toBe(2);
    expect(err).toContain("fora: no site specified");
  });

  it("rejects conflicting output flags", async () => {
    const { err, code } = await run("hot", "--json", "--human");
    expect(code).toBe(2);
    expect(JSON.parse(err.trim()).message).toContain("cannot be combined");
  });

  it("ships a bundled core skill for agents", async () => {
    const { out, code } = await run("skills", "get", "core");
    expect(code).toBe(0);
    expect(out).toContain("# fora core skill");
    expect(out).toContain("fora schema");
    expect(out).toContain("meta.degraded_sites");
  });

  it("exposes a machine-readable schema", async () => {
    const { out, code } = await run("schema");
    expect(code).toBe(0);
    const schema = JSON.parse(out);
    expect(schema.schema).toBe("fora/v1-schema");
    expect(schema.commands.map((command: { name: string }) => command.name)).toContain("hot");
    expect(schema.topic_fields).toContain("reply_count");
  });

  it("returns command schema from help --json", async () => {
    const { out, code } = await run("help", "hot", "--json");
    expect(code).toBe(0);
    expect(JSON.parse(out).name).toBe("hot");
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
      ["schema"],
      ["skills"],
      ["skills", "get"],
      ["skills", "list"],
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
