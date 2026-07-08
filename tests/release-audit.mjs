import { strict as assert } from "node:assert";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, "..");
const iconSizes = [16, 32, 48, 128];

async function main() {
  const manifest = await readJson("manifest.json");

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "ClickUp Sidebar Hierarchy Helper");
  assert.match(manifest.description, /ClickUp sidebar/i);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);

  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(Object.hasOwn(manifest, "host_permissions"), false);

  assert.equal(manifest.content_scripts.length, 1);
  const [contentScript] = manifest.content_scripts;
  assert.deepEqual(contentScript.matches, ["https://app.clickup.com/*"]);
  assert.deepEqual(contentScript.js, ["content.js"]);
  assert.deepEqual(contentScript.css, ["content.css"]);
  assert.equal(contentScript.run_at, "document_idle");
  assert(!contentScript.matches.some((match) => match.includes("<all_urls>") || match.includes("*://")));

  assert.equal(manifest.action.default_popup, "popup.html");
  assert.equal(manifest.action.default_title, "ClickUp Hierarchy Helper");

  for (const size of iconSizes) {
    const iconPath = `icons/icon${size}.png`;
    assert.equal(manifest.icons[String(size)], iconPath);
    assert.equal(manifest.action.default_icon[String(size)], iconPath);
    const dimensions = await readPngDimensions(iconPath);
    assert.deepEqual(dimensions, { width: size, height: size });
  }

  const privacy = await readText("PRIVACY.md");
  assert.match(privacy, /does not collect/i);
  assert.match(privacy, /Call the ClickUp API/i);
  assert.match(privacy, /local settings/i);
  assert.doesNotMatch(privacy, /expandedSpaceKeys/);

  const readme = await readText("README.md");
  assert.match(readme, /Run:\n\n```sh\n\.\/scripts\/package\.sh/);
  assert.match(readme, /No expand-all control/i);

  const storeListing = await readText("STORE_LISTING.md");
  assert.match(storeListing, /Productivity/);
  assert.match(storeListing, /No external analytics/i);
  assert.doesNotMatch(storeListing, /expand-all/i);

  const shippedText = [
    await readText("manifest.json"),
    await readText("content.js"),
    await readText("content.css"),
    await readText("popup.html"),
    await readText("popup.js"),
    readme,
    privacy,
    storeListing
  ].join("\n");
  assert.doesNotMatch(shippedText, /\/Users\//);
  assert.doesNotMatch(shippedText, /yogesh|yogee/i);
  assert.doesNotMatch(shippedText, /901\d{6,}/);

  const packageScript = await stat(path.join(root, "scripts", "package.sh"));
  assert(packageScript.mode & 0o111, "package.sh should be executable");
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

async function readText(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

async function readPngDimensions(relativePath) {
  const bytes = await readFile(path.join(root, relativePath));
  assert.equal(bytes.toString("ascii", 1, 4), "PNG");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
