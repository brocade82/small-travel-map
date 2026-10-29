/**
 * Loads the bundled main.js with a minimal `obsidian` stub. This catches
 * syntax errors, unresolved imports and top-level crashes without launching
 * Obsidian. Run: node scripts/smoke.cjs
 */
const Module = require("node:module");
const path = require("node:path");

class Base {}
class Plugin extends Base {}
class ItemView extends Base {}
class Modal extends Base {}
class PluginSettingTab extends Base {}
class FuzzySuggestModal extends Base {}
class Notice {
  constructor(message) {
    this.message = message;
  }
  hide() {}
}
class Setting extends Base {}
class TFile extends Base {}
class TFolder extends Base {}
class Menu extends Base {}
class MarkdownView extends Base {}

const stub = {
  Plugin,
  ItemView,
  Modal,
  PluginSettingTab,
  FuzzySuggestModal,
  Notice,
  Setting,
  TFile,
  TFolder,
  Menu,
  MarkdownView,
  parseYaml: () => ({}),
  setIcon: () => {},
  normalizePath: (value) => value,
  requestUrl: async () => ({ status: 200, json: { status: "1" } }),
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") return stub;
  if (request === "electron") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const bundlePath = path.resolve(__dirname, "..", "main.js");
const loaded = require(bundlePath);
const PluginClass = loaded.default ?? loaded;
if (typeof PluginClass !== "function") {
  throw new Error("main.js does not export a plugin class");
}
const methods = ["onload", "onunload", "loadSettings", "saveSettings", "openMap"];
for (const method of methods) {
  if (typeof PluginClass.prototype[method] !== "function") {
    throw new Error(`plugin class is missing ${method}()`);
  }
}
console.log(
  `smoke ok: ${bundlePath} (${(require("node:fs").statSync(bundlePath).size / 1024).toFixed(
    1
  )} KiB, export=${PluginClass.name})`
);
