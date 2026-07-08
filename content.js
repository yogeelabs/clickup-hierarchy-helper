(() => {
  "use strict";

  const DEFAULT_SETTINGS = {
    enabled: true,
    openFirstListOnCollapsedFolderClick: true
  };

  const SCRIPT_VERSION = "0.2.1";
  const LEGACY_BUTTON_ATTR = "data-chh-expand-button";
  const LEGACY_ENHANCED_ATTR = "data-chh-space-enhanced";
  const TEST_HOOK_NAME = "__ClickUpHierarchyHelper";
  const activeFolderClicks = new WeakSet();
  const activeSpaceToggles = new WeakSet();
  const expansionOnlyClicks = new WeakSet();
  const state = {
    settings: { ...DEFAULT_SETTINGS },
    observer: null,
    refreshTimer: null,
    toastTimer: null
  };

  const storage = createStorageAdapter();

  const selectors = {
    sidebarRoots: [
      "aside",
      "[data-testid='sidebar']",
      "[data-test='project-list-bar']",
      "[data-testid='project-list-bar']",
      "cu-sidebar-flat-tree",
      "cdk-virtual-scroll-viewport[data-test='project-list-bar__scrollable']",
      "cdk-virtual-scroll-viewport[data-testid='project-list-bar__scrollable']",
      ".home-sidebar"
    ],
    spaces: [
      "[data-chh-kind='space']",
      "a[href*='/v/s/']",
      "[role='treeitem'][aria-level='1']"
    ],
    folders: [
      "[data-chh-kind='folder']",
      "[data-test*='folder' i]",
      "[data-testid*='folder' i]",
      "[class*='folder' i]",
      "a[href*='/v/f/']",
      "[role='treeitem'][aria-level='2']"
    ],
    lists: [
      "[data-chh-kind='list']",
      "a[href*='/l/']",
      "a[href*='/list/']",
      "a[href*='/v/li/']",
      "[data-test*='list' i]",
      "[data-testid*='list' i]",
      "[class*='list' i]",
      "[role='treeitem'][aria-level='3']"
    ]
  };

  init();

  async function init() {
    document.documentElement.dataset.chhScriptVersion = SCRIPT_VERSION;
    state.settings = await loadSettings();
    syncDebugState();
    removeLegacySpaceButtons();
    observe();
    exposeTestHook();

    if (!state.settings.enabled) return;

    document.addEventListener("click", onDocumentClick, true);

    if (isChromeStorageAvailable()) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local") return;
        const next = { ...state.settings };
        for (const [key, change] of Object.entries(changes)) {
          if (key in DEFAULT_SETTINGS) next[key] = change.newValue;
        }
        state.settings = normalizeSettings(next);
        syncDebugState();
        scheduleRefresh();
      });
    }
  }

  function createStorageAdapter() {
    if (isChromeStorageAvailable()) {
      return {
        async get(keys) {
          return chrome.storage.local.get(keys);
        },
        async set(values) {
          return chrome.storage.local.set(values);
        }
      };
    }

    const memory = { ...DEFAULT_SETTINGS };
    return {
      async get(keys) {
        if (!keys) return { ...memory };
        const result = {};
        for (const key of keys) result[key] = memory[key];
        return result;
      },
      async set(values) {
        Object.assign(memory, values);
      }
    };
  }

  function isChromeStorageAvailable() {
    return Boolean(globalThis.chrome?.storage?.local);
  }

  async function loadSettings() {
    try {
      const stored = await storage.get(Object.keys(DEFAULT_SETTINGS));
      return normalizeSettings({ ...DEFAULT_SETTINGS, ...stored });
    } catch (_error) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function normalizeSettings(settings) {
    return {
      enabled: settings.enabled !== false,
      openFirstListOnCollapsedFolderClick:
        settings.openFirstListOnCollapsedFolderClick !== false
    };
  }

  function syncDebugState() {
    document.documentElement.dataset.chhEnabled = String(state.settings.enabled);
  }

  function observe() {
    if (state.observer) return;
    state.observer = new MutationObserver(scheduleRefresh);
    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-expanded", "class", "style"]
    });
  }

  function scheduleRefresh() {
    window.clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(removeLegacySpaceButtons, 140);
  }

  function removeLegacySpaceButtons() {
    document.querySelectorAll(`[${LEGACY_BUTTON_ATTR}]`).forEach((button) => button.remove());
    document.querySelectorAll(`[${LEGACY_ENHANCED_ATTR}]`).forEach((row) => {
      row.removeAttribute(LEGACY_ENHANCED_ATTR);
      row.classList.remove("chh-space-row-enhanced");
    });
  }

  async function onDocumentClick(event) {
    if (!state.settings.enabled) return;
    if (event.defaultPrevented || event.target.closest?.(`[${LEGACY_BUTTON_ATTR}]`)) return;
    if (!closestSidebarRoot(event.target)) return;
    if (isListClickTarget(event.target)) return;

    const spaceRow = closestSpaceRow(event.target);
    if (spaceRow && !activeSpaceToggles.has(spaceRow)) {
      if (isSpaceAuxiliaryClickTarget(event.target, spaceRow)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      activeSpaceToggles.add(spaceRow);
      try {
        clickExpansionTarget(spaceRow);
      } finally {
        window.setTimeout(() => activeSpaceToggles.delete(spaceRow), 0);
      }
      return;
    }

    if (!state.settings.openFirstListOnCollapsedFolderClick) return;

    const folderRow = closestFolderRow(event.target);
    if (!folderRow || activeFolderClicks.has(folderRow)) return;
    if (expansionOnlyClicks.has(folderRow)) return;
    if (isFolderAuxiliaryClickTarget(event.target, folderRow)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    activeFolderClicks.add(folderRow);
    try {
      let firstList = findFirstListInFolder(folderRow);
      if (!firstList) {
        clickExpansionTarget(folderRow, { expansionOnly: true });
        firstList = await waitForFirstList(folderRow, 2000);
      }
      if (firstList) {
        clickNavigationTarget(firstList);
      } else {
        showToast("No list was found inside that folder.");
      }
    } finally {
      window.setTimeout(() => activeFolderClicks.delete(folderRow), 0);
    }
  }

  function isSpaceAuxiliaryClickTarget(target, spaceRow) {
    const element = target instanceof Element ? target : target?.parentElement;
    if (!element || !spaceRow.contains(element)) return false;
    const expansionControl = findExpansionTarget(spaceRow);
    if (expansionControl && (element === expansionControl || expansionControl.contains(element))) return true;
    const control = element.closest(
      "button, input, select, textarea, [role='button'], [role='menuitem'], [aria-haspopup], [data-test*='menu' i], [data-testid*='menu' i], [class*='menu' i], [class*='ellipsis' i], [class*='actions' i]"
    );
    return Boolean(control);
  }

  function isFolderAuxiliaryClickTarget(target, folderRow) {
    const element = target instanceof Element ? target : target?.parentElement;
    if (!element || !folderRow.contains(element)) return false;
    const link = element.closest("a[href]");
    const control = element.closest(
      "button, input, select, textarea, [role='button'], [role='menuitem'], [aria-haspopup], [data-test*='menu' i], [data-testid*='menu' i], [class*='menu' i]"
    );
    return Boolean(control && (!link || !folderRow.contains(link)));
  }

  function isListClickTarget(target) {
    const element = target instanceof Element ? target : target?.parentElement;
    if (!element) return false;
    const listAnchor = element.closest("a[href*='/v/li/'], a[href*='/l/'], a[href*='/list/']");
    if (listAnchor) return true;
    const row = element.closest("cdk-tree-node, [data-chh-row], [data-chh-kind='list']");
    return Boolean(row && isListRow(row));
  }

  function closestSidebarRoot(target) {
    const element = target instanceof Element ? target : target?.parentElement;
    if (!element) return null;
    for (const selector of selectors.sidebarRoots) {
      try {
        const root = element.closest(selector);
        if (root) return root;
      } catch (_error) {
        // Ignore selectors unsupported by a browser version.
      }
    }
    return null;
  }

  function closestSpaceRow(target) {
    const element = target instanceof Element ? target : target?.parentElement;
    const row = toRow(element);
    return row && isSpaceRow(row) ? row : null;
  }

  function closestFolderRow(target) {
    let node = target instanceof Element ? target : target?.parentElement;
    while (node && node !== document.body) {
      const row = toRow(node);
      if (row && isFolderRow(row)) return row;
      node = node.parentElement;
    }
    return null;
  }

  function clickExpansionTarget(row, options = {}) {
    const target = findExpansionTarget(row) || row;
    if (options.expansionOnly) {
      expansionOnlyClicks.add(row);
    }
    target.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window
    }));
    if (options.expansionOnly) {
      window.setTimeout(() => expansionOnlyClicks.delete(row), 0);
    }
  }

  function findExpansionTarget(row) {
    const candidates = queryAll(row, [
      ".row-toggle",
      ".toggle",
      ".expand-button",
      "[data-test*='toggle' i]",
      "[data-testid*='toggle' i]",
      "[class*='chevron' i]",
      "[class*='toggle' i]",
      "button[aria-expanded]",
      "[role='button'][aria-expanded]"
    ]);

    return candidates.find((candidate) => {
      if (!(candidate instanceof Element)) return false;
      if (candidate.closest(`[${LEGACY_BUTTON_ATTR}]`)) return false;
      const label = `${candidate.getAttribute("aria-label") || ""} ${candidate.className || ""}`;
      if (/\bmenu\b|ellipsis|actions?/i.test(label)) return false;
      const rect = candidate.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }) || candidates.find((candidate) => {
      if (!(candidate instanceof Element)) return false;
      const label = `${candidate.getAttribute("aria-label") || ""} ${candidate.className || ""}`;
      return !/\bmenu\b|ellipsis|actions?/i.test(label);
    }) || null;
  }

  function clickNavigationTarget(row) {
    const target = row.matches("a[href]") ? row : row.querySelector("a[href]") || row;
    if (target instanceof HTMLElement && typeof target.click === "function") {
      target.click();
      return;
    }
    target.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window
    }));
  }

  async function waitForFirstList(folderRow, timeoutMs) {
    const startedAt = Date.now();
    let firstList = findFirstListInFolder(folderRow);
    while (!firstList && Date.now() - startedAt < timeoutMs) {
      await wait(90);
      firstList = findFirstListInFolder(folderRow);
    }
    return firstList;
  }

  function findFirstListInFolder(folderRow) {
    const nested = queryAll(folderRow, selectors.lists)
      .map(toRow)
      .find((row) => row && row !== folderRow && isVisible(row) && isListRow(row));
    if (nested) return nested;

    const block = blockAfterRow(folderRow, (node) => isFolderRow(node) || isSpaceRow(node));
    for (const node of block) {
      if (isListRow(node) && isVisible(node)) return node;
      const descendant = queryAll(node, selectors.lists)
        .map(toRow)
        .find((row) => row && isVisible(row) && isListRow(row));
      if (descendant) return descendant;
    }
    return null;
  }

  function blockAfterRow(row, stopPredicate) {
    const block = [];
    let node = row.nextElementSibling;
    while (node) {
      if (stopPredicate(node)) break;
      block.push(node);
      node = node.nextElementSibling;
    }
    return block;
  }

  function isSpaceRow(row) {
    return looksLikeSpaceRow(row);
  }

  function isFolderRow(row) {
    if (!row?.matches) return false;
    if (row.matches("[data-chh-kind='folder']")) return true;
    if (row.matches("cdk-tree-node") && row.querySelector("a[href*='/v/f/']")) return true;
    if (row.querySelector(".cu-category-row__inner")) return true;
    if (row.matches("a[href*='/v/f/']") || row.querySelector("a[href*='/v/f/']")) return true;
    if (row.matches(selectors.folders.join(","))) return true;
    const text = textOf(row);
    return /\bfolder\b/i.test(row.getAttribute("aria-label") || "") ||
      /\bfolder\b/i.test(row.className || "") ||
      /^Prj\s*-/.test(text);
  }

  function isListRow(row) {
    if (!row?.matches) return false;
    if (row.matches("[data-chh-kind='list']")) return true;
    if (row.matches("cdk-tree-node") && row.querySelector("a[href*='/v/li/']")) return true;
    if (row.querySelector(".cu-subcategory-row__inner")) return true;
    if (row.matches("a[href*='/v/li/']") || row.querySelector("a[href*='/v/li/']")) return true;
    if (row.matches("a[href*='/l/'], a[href*='/list/']")) return true;
    if (row.querySelector("a[href*='/l/'], a[href*='/list/']")) return true;
    const label = `${row.getAttribute("aria-label") || ""} ${row.className || ""}`;
    return /\blist\b/i.test(label) && !isFolderRow(row);
  }

  function looksLikeSpaceRow(row) {
    if (!row) return false;
    if (row.matches?.("[data-chh-kind='space']")) return true;
    if (row.matches?.("cdk-tree-node")) {
      const href = row.querySelector("a[href*='/v/s/']")?.getAttribute("href") || "";
      const text = textOf(row);
      return /\/v\/s\/\d+/.test(href) && /^\d{1,2}\s+\S/.test(text);
    }
    if (row.matches?.("a[href*='/v/s/']") || row.querySelector?.("a[href*='/v/s/']")) {
      return row.closest?.("cdk-tree-node") ? /^\d{1,2}\s+\S/.test(textOf(row.closest("cdk-tree-node"))) : false;
    }
    const text = textOf(row);
    const label = `${row.getAttribute?.("aria-label") || ""} ${row.className || ""}`;
    if (/\bspace\b/i.test(label) && text.length > 0) return true;
    return /^\d{2}\s+\S/.test(text);
  }

  function queryAll(root, selectorList) {
    const found = [];
    for (const selector of selectorList) {
      try {
        found.push(...root.querySelectorAll(selector));
      } catch (_error) {
        // Ignore selectors unsupported by a browser version.
      }
    }
    return [...new Set(found)];
  }

  function toRow(element) {
    if (!element || !(element instanceof Element)) return null;
    const treeNode = element.closest("cdk-tree-node");
    if (treeNode) return treeNode;
    return element.closest(
      "[data-chh-row], [data-chh-kind], [role='treeitem'], li, a, button, [data-test], [data-testid]"
    ) || element;
  }

  function textOf(element) {
    return (element?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (element.closest("[hidden], [aria-hidden='true']")) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function showToast(message) {
    let toast = document.querySelector(".chh-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "chh-toast";
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add("chh-toast-visible");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      toast.classList.remove("chh-toast-visible");
    }, 2400);
  }

  function exposeTestHook() {
    if (!/^(file:|http:\/\/127\.0\.0\.1|http:\/\/localhost)/.test(location.href)) return;
    globalThis[TEST_HOOK_NAME] = {
      refresh: removeLegacySpaceButtons,
      findFirstListInFolder,
      getSettings: () => ({ ...state.settings, scriptVersion: SCRIPT_VERSION }),
      setSettings: async (settings) => {
        state.settings = normalizeSettings({ ...state.settings, ...settings });
        await storage.set(state.settings);
        syncDebugState();
        removeLegacySpaceButtons();
      }
    };
  }
})();
