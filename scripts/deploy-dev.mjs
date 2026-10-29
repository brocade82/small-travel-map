/**
 * Copies the built plugin into dev-vault and points it at dev-media.
 * Run after `main.js` is built and `create-dev-vault.mjs` has created the vault.
 *
 *   node scripts/deploy-dev.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const vault = path.join(root, "dev-vault");
const pluginDir = path.join(vault, ".obsidian", "plugins", "travel-map");

if (!fs.existsSync(vault)) {
  console.error("dev-vault is missing; run: node scripts/create-dev-vault.mjs");
  process.exit(1);
}
if (!fs.existsSync(path.join(root, "main.js"))) {
  console.error("main.js is missing; build the plugin first");
  process.exit(1);
}

fs.mkdirSync(pluginDir, { recursive: true });
for (const file of ["manifest.json", "main.js", "styles.css"]) {
  fs.copyFileSync(path.join(root, file), path.join(pluginDir, file));
}

const settings = {
  baseFolder: "旅游",
  mediaRoot: path.join(root, "dev-media").replace(/\\/g, "\\"),
  amapConfigPath: path.join(root, "..", "amap-keys.json"),
  poiTypes: "110000|140100|140200|140300|190500",
  sessionSearchLimit: 10,
  mapMode: "offline",
  mapPackDir: "",
  mapIdleMinutes: 0,
  mediaLinkMode: "absolute",
  ffprobePath: "",
};
fs.writeFileSync(
  path.join(pluginDir, "data.json"),
  `${JSON.stringify(settings, null, 2)}\n`,
  "utf8"
);

const communityPath = path.join(vault, ".obsidian", "community-plugins.json");
let enabled = [];
try {
  enabled = JSON.parse(fs.readFileSync(communityPath, "utf8"));
  if (!Array.isArray(enabled)) enabled = [];
} catch {
  enabled = [];
}
if (!enabled.includes("travel-map")) enabled.push("travel-map");
fs.writeFileSync(communityPath, `${JSON.stringify(enabled, null, 2)}\n`, "utf8");

console.log(`deployed travel-map -> ${pluginDir}`);
console.log(`mediaRoot -> ${settings.mediaRoot}`);
