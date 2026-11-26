import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const assetName = "fora-linux-x64";
const fakeBinary = "#!/bin/sh\necho fora-test\n";

async function runInstall(badChecksum: boolean) {
  const temp = join(await mkdtemp(), "install-test");
  await mkdir(temp, { recursive: true });
  const fakeBin = join(temp, "fake-bin");
  const installDir = join(temp, "installed");
  await mkdir(fakeBin, { recursive: true });
  await writeFile(
    join(fakeBin, "uname"),
    `#!/bin/sh\nif [ "$1" = "-s" ]; then echo Linux; elif [ "$1" = "-m" ]; then echo x86_64; else echo "Linux x86_64"; fi\n`,
    { mode: 0o755 },
  );

  const checksum = badChecksum
    ? `0000000000000000000000000000000000000000000000000000000000000000  ${assetName}\n`
    : `${createHash("sha256").update(fakeBinary).digest("hex")}  ${assetName}\n`;

  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/latest") return Response.json({ tag_name: "fora-cli-v0.0.0-test" });
      if (path.endsWith(`/${assetName}.sha256`)) return new Response(checksum);
      if (path.endsWith(`/${assetName}`)) return new Response(fakeBinary);
      return new Response("not found", { status: 404 });
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;

  const proc = Bun.spawn(["sh", "install.sh"], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      FORA_GITHUB_API: `${origin}/latest`,
      FORA_RELEASE_BASE: `${origin}/assets`,
      FORA_VERSION: "fora-cli-v0.0.0-test",
      FORA_INSTALL_DIR: installDir,
      FORA_VERIFY_ATTESTATION: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  server.stop(true);

  return { code: proc.exitCode, out, err, installDir, temp };
}

async function mkdtemp() {
  const prefix = join(process.env.TMPDIR ?? "/tmp", "fora-install-");
  const { mkdtemp: nodeMkdtemp } = await import("node:fs/promises");
  return nodeMkdtemp(prefix);
}

describe("install.sh", () => {
  it("downloads, verifies and installs the matching asset", async () => {
    const result = await runInstall(false);
    try {
      expect(result.code).toBe(0);
      expect(result.out).toContain("Installed ");
      expect(await Bun.file(join(result.installDir, "fora")).text()).toBe(fakeBinary);
    } finally {
      await rm(result.temp, { recursive: true, force: true });
    }
  });

  it("fails on checksum mismatch", async () => {
    const result = await runInstall(true);
    try {
      expect(result.code).not.toBe(0);
      expect(result.err).toContain("checksum");
    } finally {
      await rm(result.temp, { recursive: true, force: true });
    }
  });
});
