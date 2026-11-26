/**
 * SOCKS support for Bun's fetch.
 *
 * Bun's fetch only understands HTTP(S) proxies (see
 * https://bun.com/guides/http/proxy.md) and rejects socks5:// with
 * UnsupportedProxyProtocol. This module starts a tiny local HTTP CONNECT
 * proxy that forwards through the configured SOCKS proxy, then passes that
 * local proxy to fetch via the documented `proxy` option. Hostnames are sent
 * to SOCKS for remote DNS, which also avoids a poisoned local resolver.
 */

import { connect, createServer, type Server, type Socket } from "node:net";
import { withBrowserFallback } from "./fallback-fetch.ts";

interface ProxyUrl {
  protocol: "socks5" | "socks5h" | "http" | "https";
  hostname: string;
  port: number;
  username?: string;
  proxyPassword?: string;
}

function proxyUrl(): ProxyUrl | undefined {
  const raw =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.ALL_PROXY ??
    process.env.all_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const protocol = url.protocol.replace(/:$/, "").toLowerCase();
    if (!["socks5", "socks5h", "http", "https"].includes(protocol)) return undefined;
    return {
      protocol: protocol as ProxyUrl["protocol"],
      hostname: url.hostname,
      port: Number(url.port || (protocol.startsWith("socks") ? 1080 : 80)),
      username: decodeURIComponent(url.username) || undefined,
      proxyPassword: decodeURIComponent(url.password) || undefined,
    };
  } catch {
    return undefined;
  }
}

async function readExactly(socket: Socket, length: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let remaining = length;
  while (remaining > 0) {
    const chunk = socket.read(remaining);
    if (chunk) {
      chunks.push(chunk as Buffer);
      remaining -= (chunk as Buffer).length;
      continue;
    }
    await new Promise<void>((resolve, reject) => {
      const onReadable = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onClose = () => {
        cleanup();
        reject(new Error("SOCKS proxy closed the connection"));
      };
      const cleanup = () => {
        socket.off("readable", onReadable);
        socket.off("error", onError);
        socket.off("close", onClose);
      };
      socket.once("readable", onReadable);
      socket.once("error", onError);
      socket.once("close", onClose);
    });
  }
  return Buffer.concat(chunks);
}

async function socksConnect(proxy: ProxyUrl, host: string, port: number): Promise<Socket> {
  const socket = connect({ host: proxy.hostname, port: proxy.port });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  socket.write(proxy.username ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]));
  const methods = await readExactly(socket, 2);
  if (methods[0] !== 0x05 || methods[1] === 0xff) {
    socket.destroy();
    throw new Error("SOCKS proxy rejected the connection");
  }
  if (methods[1] === 0x02) {
    if (!proxy.username || !proxy.proxyPassword) {
      socket.destroy();
      throw new Error("SOCKS proxy requires authentication");
    }
    const user = Buffer.from(proxy.username);
    const pass = Buffer.from(proxy.proxyPassword);
    socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]));
    const auth = await readExactly(socket, 2);
    if (auth[1] !== 0x00) {
      socket.destroy();
      throw new Error("SOCKS proxy authentication failed");
    }
  } else if (methods[1] !== 0x00) {
    socket.destroy();
    throw new Error("unsupported SOCKS authentication method");
  }

  const hostBytes = Buffer.from(host);
  const portBytes = Buffer.alloc(2);
  portBytes.writeUInt16BE(port);
  socket.write(
    Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x03, hostBytes.length]),
      hostBytes,
      portBytes,
    ]),
  );

  const reply = await readExactly(socket, 4);
  if (reply[1] !== 0x00) {
    socket.destroy();
    throw new Error(`SOCKS proxy could not connect to ${host}:${port} (code ${reply[1]})`);
  }
  const boundLength =
    reply[3] === 0x01 ? 4 : reply[3] === 0x04 ? 16 : reply[3] === 0x03 ? (await readExactly(socket, 1))[0]! : 0;
  await readExactly(socket, boundLength + 2);
  return socket;
}

async function readHead(client: Socket): Promise<string> {
  return await new Promise((resolve, reject) => {
    let head = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("proxy request timed out"));
    }, 10_000);
    const onData = (chunk: Buffer) => {
      head += chunk.toString("latin1");
      if (head.includes("\r\n\r\n")) {
        cleanup();
        resolve(head);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      client.off("data", onData);
      client.off("error", onError);
    };
    client.on("data", onData);
    client.on("error", onError);
  });
}

async function handleClient(client: Socket, proxy: ProxyUrl): Promise<void> {
  let upstream: Socket | undefined;
  try {
    const head = await readHead(client);
    const [requestLine, ...headers] = head.split("\r\n");
    const parts = requestLine!.split(" ");
    const [method, target] = parts;

    if (method === "CONNECT") {
      const [host, port] = target!.split(":");
      upstream = await socksConnect(proxy, host!, Number(port));
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    } else {
      const url = new URL(target!);
      upstream = await socksConnect(proxy, url.hostname, Number(url.port || (url.protocol === "https:" ? 443 : 80)));
      const path = `${url.pathname}${url.search}`;
      upstream.write(`${method} ${path} HTTP/1.1\r\n`);
      for (const header of headers) {
        if (header && !/^proxy-authorization:/i.test(header)) upstream.write(`${header}\r\n`);
      }
      upstream.write("\r\n");
    }

    // Any bytes Bun pipelined after the headers belong to the tunnel.
    const split = head.indexOf("\r\n\r\n") + 4;
    if (split < head.length) upstream.write(Buffer.from(head.slice(split), "latin1"));

    client.pipe(upstream);
    upstream.pipe(client);
    upstream.once("error", () => {
      client.destroy();
    });
    client.once("error", () => {
      upstream?.destroy();
    });
  } catch (error) {
    client.end(`HTTP/1.1 502 Bad Gateway\r\n\r\n${String(error)}`);
    client.destroy();
    upstream?.destroy();
  }
}

const bridgeSockets = new Set<Socket>();
let bridge: { key: string; url: string; server: Server } | undefined;

async function ensureBridge(proxy: ProxyUrl): Promise<string> {
  const key = `${proxy.protocol}://${proxy.hostname}:${proxy.port}`;
  if (bridge?.key === key) return bridge.url;
  if (bridge) bridge.server.close();

  const server = createServer((client) => {
    bridgeSockets.add(client);
    client.once("close", () => bridgeSockets.delete(client));
    void handleClient(client, proxy);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("could not start local SOCKS bridge");
  server.unref();
  bridge = { key, url: `http://127.0.0.1:${address.port}`, server };
  return bridge.url;
}

function fetchViaBridge(proxy: ProxyUrl): typeof fetch {
  let localProxy: Promise<string> | undefined;
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    localProxy ??= ensureBridge(proxy);
    return await globalThis.fetch(input, { ...init, proxy: await localProxy } as RequestInit);
  }) as typeof fetch;
}

/** Test/cleanup helper: stop the local SOCKS bridge if one was started. */
export function closeProxyBridge(): void {
  bridge?.server.close();
  for (const socket of bridgeSockets) socket.destroy();
  bridgeSockets.clear();
  bridge = undefined;
}

/** Use Bun's native fetch, bridge SOCKS when needed, and add generic anti-bot fallback. */
export function createFetch(): typeof fetch {
  const proxy = proxyUrl();
  let base = globalThis.fetch;
  if (proxy?.protocol === "socks5" || proxy?.protocol === "socks5h") base = fetchViaBridge(proxy);
  return withBrowserFallback(base);
}
