"use strict";

const DEFAULT_SETTINGS = {
  enabled: true,
  openFirstListOnCollapsedFolderClick: true
};

const settingIds = [
  "enabled",
  "openFirstListOnCollapsedFolderClick"
];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const settings = await loadSettings();
  for (const id of settingIds) {
    const input = document.getElementById(id);
    input.checked = settings[id] !== false;
    input.addEventListener("change", () => saveSetting(id, input.checked));
  }

  document.getElementById("reset").addEventListener("click", resetState);
}

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...stored });
  } catch (_error) {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSetting(key, value) {
  await chrome.storage.local.set({ [key]: value });
  setStatus("Saved");
}

async function resetState() {
  await chrome.storage.local.set({ ...DEFAULT_SETTINGS });
  for (const id of settingIds) {
    document.getElementById(id).checked = DEFAULT_SETTINGS[id];
  }
  setStatus("Reset");
}

function setStatus(message) {
  const status = document.getElementById("status");
  status.textContent = message;
  window.clearTimeout(setStatus.timer);
  setStatus.timer = window.setTimeout(() => {
    status.textContent = "";
  }, 1600);
}

function normalizeSettings(settings) {
  return {
    enabled: settings.enabled !== false,
    openFirstListOnCollapsedFolderClick:
      settings.openFirstListOnCollapsedFolderClick !== false
  };
}
