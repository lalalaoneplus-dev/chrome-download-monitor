import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const errors = [];

if (manifest.manifest_version !== 3) {
  errors.push("manifest_version must be 3");
}

for (const required of [
  manifest.background?.service_worker,
  manifest.options_page,
  "dashboard.css",
  "dashboard.js",
  "src/downloads.js",
  "src/log-dom.js",
  "src/log-format.js",
  "src/log-groups.js",
  "src/settings.js"
]) {
  if (!required || !fs.existsSync(path.join(root, required))) {
    errors.push(`Missing required extension file: ${required || "(undefined)"}`);
  }
}

const expectedPermissions = ["alarms", "downloads", "storage", "unlimitedStorage"];
if (JSON.stringify(manifest.permissions) !== JSON.stringify(expectedPermissions)) {
  errors.push(`permissions must be exactly: ${expectedPermissions.join(", ")}`);
}

if (manifest.host_permissions || manifest.optional_host_permissions || manifest.content_scripts) {
  errors.push("host permissions and content scripts are not allowed");
}

if (manifest.incognito !== "not_allowed") {
  errors.push("incognito must be not_allowed");
}

if (!manifest.content_security_policy?.extension_pages?.includes("connect-src 'none'")) {
  errors.push("extension CSP must block outbound connections");
}

if (manifest.homepage_url !== "https://thenexuspivot.com/apps/download-monitor/") {
  errors.push("homepage_url must point to the Download Monitor product page");
}

for (const size of ["16", "32", "48", "128"]) {
  const icon = manifest.icons?.[size];
  const actionIcon = manifest.action?.default_icon?.[size];
  if (!icon || !fs.existsSync(path.join(root, icon))) {
    errors.push(`Missing extension icon: ${size}px`);
  }
  if (!actionIcon || !fs.existsSync(path.join(root, actionIcon))) {
    errors.push(`Missing action icon: ${size}px`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Validated ${manifest.name} v${manifest.version} (Manifest V3).`);
