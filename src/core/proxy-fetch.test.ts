import { afterEach, describe, expect, it } from "bun:test";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer, connect, type Socket } from "node:net";
import { closeProxyBridge, createFetch } from "./proxy-fetch.ts";

const savedEnv = {
  HTTP_PROXY: process.env.HTTP_PROXY,
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  ALL_PROXY: process.env.ALL_PROXY,
  http_proxy: process.env.http_proxy,
  https_proxy: process.env.https_proxy,
  all_proxy: process.env.all_proxy,
};

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  closeProxyBridge();
});

async function listen(server: {
  listen: (port: number, host: string, cb: () => void) => unknown;
  address: () => { port: number } | string | null;
}): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  return address.port;
}

function startSocksProxy(onConnect: (host: string, port: number) => void): Promise<number> {
  const server = createNetServer((client) => {
    const buffer: Buffer[] = [];
    const read = async (length: number): Promise<Buffer> => {
      let out = Buffer.concat(buffer.splice(0));
      while (out.length < length) {
        out = Buffer.concat([out, await new Promise<Buffer>((resolve) => client.once("data", resolve))]);
      }
      buffer.push(out.subarray(length));
      return out.subarray(0, length);
    };

    void (async () => {
      const greeting = await read(3);
      expect(greeting[0]).toBe(0x05);
      client.write(Buffer.from([0x05, 0x00]));
      const request = await read(4);
      const hostLength = request[3] === 0x03 ? (await read(1))[0]! : 0;
      const hostBuffer = await read(hostLength + 2);
      const host = hostBuffer.subarray(0, hostLength).toString();
      const port = hostBuffer.readUInt16BE(hostLength);
      onConnect(host, port);
      client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
      const upstream = connect({ host, port });
      client.pipe(upstream);
      upstream.pipe(client);
    })();
  });
  return listen(server);
}

describe("proxy-fetch", () => {
  it("uses fetch directly when no proxy is configured", () => {
    for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
      delete process.env[key];
    }
    expect(typeof createFetch()).toBe("function");
  });

  it("bridges a SOCKS proxy into Bun's fetch proxy option", async () => {
    const target = createHttpServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("hello from socks");
    });
    const targetPort = await listen(target);

    let connectedTo = "";
    const socksPort = await startSocksProxy((host, port) => {
      connectedTo = `${host}:${port}`;
    });

    process.env.HTTP_PROXY = `socks5://127.0.0.1:${socksPort}`;
    process.env.HTTPS_PROXY = `socks5://127.0.0.1:${socksPort}`;
    delete process.env.ALL_PROXY;
    delete process.env.all_proxy;

    const fetchWithProxy = createFetch();
    const response = await fetchWithProxy(`http://127.0.0.1:${targetPort}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello from socks");
    expect(connectedTo).toBe(`127.0.0.1:${targetPort}`);

    target.close();
  });
});
