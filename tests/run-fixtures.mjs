import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, "..");
const chromePath = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function main() {
  const browser = await launchChrome();
  try {
    await testBasicSidebar(browser);
    await testNoListSidebar(browser);
    await testMainTaskClick(browser);
  } finally {
    await browser.close();
  }
}

async function testMainTaskClick(browser) {
  const page = await browser.newPage();
  try {
    await page.open("main-task-click.html");
    await page.evaluate("document.querySelector('[data-test=\"task-list__task-row\"]').click()");
    await waitFor(() => page.evaluate("location.hash === '#task-detail'"), 3000, "native main task navigation");

    await page.evaluate(`
      location.hash = "";
      const folder = document.querySelector('[data-chh-kind="folder"]');
      folder.setAttribute("aria-expanded", "false");
      folder.querySelector(".toggle").setAttribute("aria-expanded", "false");
      folder.nextElementSibling.hidden = true;
    `);
    await page.evaluate("document.querySelector('[data-chh-kind=\"folder\"]').click()");
    await waitFor(() => page.evaluate("location.hash === '#project-tasks'"), 3000, "sidebar folder still opens first list");
  } finally {
    await page.close();
  }
}

async function launchChrome() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "chh-chrome-"));
  const proc = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ], {
    stdio: ["ignore", "ignore", "pipe"]
  });

  let stderr = "";
  proc.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const portFile = path.join(userDataDir, "DevToolsActivePort");
  const port = await waitFor(async () => {
    try {
      const [line] = (await readFile(portFile, "utf8")).split("\n");
      return Number(line);
    } catch (_error) {
      return null;
    }
  }, 5000, "Chrome DevTools port");

  return {
    port,
    async newPage() {
      const target = await createTarget(port);
      return connectTarget(target.webSocketDebuggerUrl);
    },
    async close() {
      proc.kill("SIGTERM");
      await waitForProcessExit(proc, 3000);
      await rm(userDataDir, { recursive: true, force: true });
      if (proc.exitCode === null && stderr.includes("DevToolsActivePort file doesn't exist")) {
        throw new Error(stderr);
      }
    }
  };
}

async function createTarget(port) {
  const url = `http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`;
  const response = await fetch(url, { method: "PUT" });
  if (!response.ok) {
    throw new Error(`Could not create Chrome target: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function connectTarget(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });

  function send(method, params = {}) {
    const id = nextId++;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  }

  return {
    async open(fileName) {
      await waitFor(() => socket.readyState === WebSocket.OPEN, 5000, "CDP socket");
      await send("Page.enable");
      await send("Runtime.enable");
      await send("Page.navigate", {
        url: pathToFileURL(path.join(root, "tests", "fixtures", fileName)).href
      });
      await waitFor(() => this.evaluate("document.readyState === 'complete'"), 5000, "page load");
      await waitFor(() => this.evaluate("Boolean(window.__ClickUpHierarchyHelper)"), 5000, "helper hook");
    },
    async evaluate(expression) {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || "Evaluation failed");
      }
      return result.result.value;
    },
    async close() {
      socket.close();
    }
  };
}

async function testBasicSidebar(browser) {
  const page = await browser.newPage();
  try {
    await page.open("basic-sidebar.html");
    await page.evaluate("window.__ClickUpHierarchyHelper.refresh()");
    assert.equal(await page.evaluate("document.querySelectorAll('[data-chh-expand-button]').length"), 0);

    assert.equal(
      await page.evaluate("window.__ClickUpHierarchyHelper.getSettings().openFirstListOnCollapsedFolderClick"),
      true
    );
    await page.evaluate("document.querySelector('[data-chh-kind=\"space\"]').click()");
    await waitFor(() => page.evaluate("document.querySelector('[data-chh-kind=\"folder\"]').hidden"), 3000, "manual space collapse");
    await new Promise((resolve) => setTimeout(resolve, 650));
    assert.equal(
      await page.evaluate("document.querySelector('[data-chh-kind=\"folder\"]').hidden"),
      true,
      "helper should not reopen a manually collapsed Space by default"
    );

    await page.evaluate("document.querySelector('[data-chh-kind=\"space\"]').click()");
    await waitFor(() => page.evaluate("!document.querySelector('[data-chh-kind=\"folder\"]').hidden"), 3000, "manual space reopen");

    await page.evaluate(`
      for (const folder of document.querySelectorAll("[data-chh-kind='folder']")) {
        folder.setAttribute("aria-expanded", "false");
        folder.nextElementSibling.hidden = true;
      }
    `);

    await page.evaluate("document.querySelector('[data-chh-kind=\"folder\"]').click()");
    await waitFor(() => page.evaluate("location.hash === '#alpha-tasks'"), 3000, "first-list navigation");

    await page.evaluate(`
      location.hash = "";
      const folder = document.querySelector('[data-chh-kind="folder"]');
      folder.setAttribute("aria-expanded", "true");
      folder.querySelector(".toggle").setAttribute("aria-expanded", "true");
      folder.nextElementSibling.hidden = false;
    `);
    await page.evaluate("document.querySelector('[data-chh-kind=\"folder\"]').click()");
    await waitFor(() => page.evaluate("location.hash === '#alpha-tasks'"), 3000, "open-folder first-list navigation");
  } finally {
    await page.close();
  }
}

async function testNoListSidebar(browser) {
  const page = await browser.newPage();
  try {
    await page.open("no-list-sidebar.html");
    await page.evaluate("window.__ClickUpHierarchyHelper.refresh()");
    assert.equal(await page.evaluate("document.querySelectorAll('[data-chh-expand-button]').length"), 0);
    await page.evaluate("document.querySelector('[data-chh-kind=\"folder\"]').click()");
    await waitFor(() => page.evaluate("document.querySelector('.chh-toast-visible') !== null"), 3000, "no-list toast");
  } finally {
    await page.close();
  }
}

async function waitFor(callback, timeoutMs, label) {
  const startedAt = Date.now();
  let lastValue;
  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await callback();
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function waitForProcessExit(proc, timeoutMs) {
  if (proc.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve();
    }, timeoutMs);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
