import net from "node:net";

async function canListenOnPort(port, host) {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    const onListen = () => {
      server.close(() => resolve(true));
    };
    if (host) {
      server.listen(port, host, onListen);
      return;
    }
    server.listen(port, onListen);
  });
}

export async function waitForPortFree(port, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const intervalMs = options.intervalMs ?? 250;
  const host = options.host ?? null;
  const startedAt = Date.now();

  while (true) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(
        `Port ${port} is still in use after restart. Stop the old dev server and retry.`,
      );
    }

    if (await canListenOnPort(port, host)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function findFirstFreePort(fromPort, options = {}) {
  const maxAttempts = options.maxAttempts ?? 20;
  const host = options.host ?? null;

  for (let i = 0; i < maxAttempts; i += 1) {
    const port = fromPort + i;
    if (await canListenOnPort(port, host)) {
      return port;
    }
  }

  throw new Error(`No free port found starting from ${fromPort}.`);
}

export function parsePortValue(value, fallback = null) {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}
