#!/usr/bin/env node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const chromePath =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const htmlUrl = pathToFileURL(resolve(root, "README.html")).href;
const outputDir = resolve(root, "assets/profile");
const deviceScaleFactor = Number(process.env.PROFILE_DEVICE_SCALE_FACTOR || 3);
const remoteDebuggingPort = await getAvailablePort();
const renderTargets = [
  {
    name: "desktop",
    viewportWidth: Number(process.env.PROFILE_DESKTOP_VIEWPORT_WIDTH || 1228),
    filenameSuffix: "",
  },
  {
    name: "mobile",
    viewportWidth: Number(process.env.PROFILE_MOBILE_VIEWPORT_WIDTH || 588),
    filenameSuffix: "-mobile",
  },
];

if (typeof WebSocket !== "function") {
  throw new Error("This script requires a Node.js runtime with global WebSocket support.");
}

mkdirSync(outputDir, { recursive: true });

const userDataDir = mkdtempSync(resolve(tmpdir(), "profile-render-"));
const chrome = spawn(chromePath, [
  "--headless=new",
  `--remote-debugging-port=${remoteDebuggingPort}`,
  "--remote-debugging-address=127.0.0.1",
  `--user-data-dir=${userDataDir}`,
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-default-browser-check",
  "--no-first-run",
  "about:blank",
], {
  stdio: ["ignore", "ignore", "pipe"],
});

let stderr = "";
chrome.stderr.setEncoding("utf8");
chrome.stderr.on("data", (chunk) => {
  stderr += chunk;
});

try {
  const browserWsUrl = await waitForBrowserWsUrl(remoteDebuggingPort);

  for (const targetConfig of renderTargets) {
    for (const colorScheme of ["light", "dark"]) {
      const target = await createTarget(browserWsUrl);
      const client = await connectCdp(target.webSocketDebuggerUrl);

      try {
        await client.send("Page.enable");
        await client.send("Runtime.enable");
        await client.send("Emulation.setEmulatedMedia", {
          features: [{ name: "prefers-color-scheme", value: colorScheme }],
        });
        await client.send("Emulation.setDeviceMetricsOverride", {
          width: targetConfig.viewportWidth,
          height: 900,
          deviceScaleFactor,
          mobile: targetConfig.name === "mobile",
        });

        const loaded = client.waitFor("Page.loadEventFired");
        await client.send("Page.navigate", { url: htmlUrl });
        await loaded;
        await client.send("Runtime.evaluate", {
          expression: "document.fonts ? document.fonts.ready : Promise.resolve()",
          awaitPromise: true,
        });

        const { result } = await client.send("Runtime.evaluate", {
          expression: `
            (() => {
              const element = document.querySelector("main");
              if (!element) throw new Error("Could not find <main> in README.html");
              const rect = element.getBoundingClientRect();
              return {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
              };
            })()
          `,
          returnByValue: true,
        });

        const clip = result.value;
        await client.send("Emulation.setDeviceMetricsOverride", {
          width: targetConfig.viewportWidth,
          height: Math.ceil(clip.y + clip.height),
          deviceScaleFactor,
          mobile: targetConfig.name === "mobile",
        });

        const screenshot = await client.send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
          clip: {
            x: clip.x,
            y: clip.y,
            width: clip.width,
            height: clip.height,
            scale: 1,
          },
        });

        const outputPath = resolve(outputDir, `${colorScheme}${targetConfig.filenameSuffix}.png`);
        writeFileSync(outputPath, Buffer.from(screenshot.data, "base64"));
        console.log(`Rendered ${outputPath}`);
      } finally {
        client.close();
        await closeTarget(browserWsUrl, target.id);
      }
    }
  }
} finally {
  chrome.kill("SIGTERM");
  await Promise.race([once(chrome, "exit"), delay(2_000)]);
  rmSync(userDataDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

async function waitForBrowserWsUrl(port) {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  const startedAt = Date.now();

  while (Date.now() - startedAt < 10_000) {
    if (chrome.exitCode !== null) {
      throw new Error(`Chrome exited early.\n${stderr.trim()}`);
    }

    try {
      const response = await fetch(endpoint);
      if (response.ok) {
        const version = await response.json();
        if (version.webSocketDebuggerUrl) {
          return version.webSocketDebuggerUrl;
        }
      }
    } catch {
      await delay(50);
    }
  }

  throw new Error(`Timed out waiting for Chrome DevTools.\n${stderr.trim()}`);
}

async function createTarget(browserWsUrl) {
  const endpoint = browserWsUrlToHttp(browserWsUrl, "/json/new");
  const response = await fetch(endpoint, { method: "PUT" });

  if (!response.ok) {
    throw new Error(`Could not create Chrome target: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function closeTarget(browserWsUrl, targetId) {
  const endpoint = browserWsUrlToHttp(browserWsUrl, `/json/close/${targetId}`);
  await fetch(endpoint);
}

function browserWsUrlToHttp(browserWsUrl, path) {
  const url = new URL(browserWsUrl);
  url.protocol = "http:";
  url.pathname = path;
  url.search = "";
  return url.href;
}

function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const eventWaiters = new Map();

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    if (message.id) {
      const callbacks = pending.get(message.id);
      if (!callbacks) return;
      pending.delete(message.id);

      if (message.error) {
        callbacks.reject(new Error(`${message.error.message}: ${message.error.data || ""}`));
      } else {
        callbacks.resolve(message.result || {});
      }
      return;
    }

    const waiters = eventWaiters.get(message.method);
    if (waiters) {
      eventWaiters.delete(message.method);
      for (const resolve of waiters) {
        resolve(message.params || {});
      }
    }
  });

  const opened = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  return {
    async send(method, params = {}) {
      await opened;
      const messageId = ++id;
      const response = new Promise((resolve, reject) => {
        pending.set(messageId, { resolve, reject });
      });
      ws.send(JSON.stringify({ id: messageId, method, params }));
      return response;
    },
    waitFor(method) {
      return new Promise((resolve) => {
        const waiters = eventWaiters.get(method) || [];
        waiters.push(resolve);
        eventWaiters.set(method, waiters);
      });
    },
    close() {
      ws.close();
    },
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}
