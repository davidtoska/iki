"use strict";
const fs = require("fs");
const path = require("path");

/** Used for any key that has no saved override in db.json. */
const defaults = {
  url: "https://web-kiosk-test.netlify.app/",
  /** Open devtools (and allow Ctrl+D to toggle them). */
  devtools: true,
  /** Run the window in kiosk (fullscreen, locked-down) mode. */
  kiosk: false,
  /**
   * The page is expected to send a message with this string at least every
   * 'reloadAfterSec' seconds, otherwise it is reloaded. Empty disables the watchdog.
   */
  ackString: "iframe-content-loaded",
  /** Number of seconds before the page reloads if no ackString is received. */
  reloadAfterSec: 100,
  username: "svein",
  deviceId: "passord1234",
};

const DB_PATH = path.join(__dirname, "db.json");
/** Config keys that may be overridden and persisted in db.json. */
const KEYS = {
  url: "url",
  username: "string",
  deviceId: "string",
  ackString: "text",
  devtools: "boolean",
  kiosk: "boolean",
  reloadAfterSec: "number",
};

/** @typedef {typeof defaults} Config */
/** @typedef {Partial<Config>} SavedConfig */

/** @param {unknown} value */
const isValidUrl = (value) => {
  if (typeof value !== "string") return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Types: "text" allows empty strings, "string" does not (empty means "not set"),
 * "url" must be http(s), numbers must be positive and finite.
 * @param {string} type
 * @param {unknown} value
 */
const isValid = (type, value) => {
  if (type === "url") return isValidUrl(value);
  if (type === "string") return typeof value === "string" && value !== "";
  if (type === "text") return typeof value === "string";
  if (type === "number")
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  return typeof value === type;
};

/**
 * Copies the valid overridable keys from `source`.
 * @param {Record<string, unknown>} source
 * @returns {SavedConfig}
 */
const pickValid = (source) => {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, type] of Object.entries(KEYS)) {
    if (isValid(type, source[key])) out[key] = source[key];
  }
  return /** @type {SavedConfig} */ (out);
};

/** @returns {Record<string, unknown>} */
const read = () => {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") console.log("[DB]: could not read db.json", e);
    return {};
  }
};

/** Writes via a temp file + rename so a crash can't leave a half-written db.json. */
/** @param {SavedConfig} data */
const write = (data) => {
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_PATH);
};

/** True if db.json holds any saved overrides. */
const hasSavedConfig = () => Object.keys(read()).length > 0;

/** Defaults from config.js with saved overrides from db.json on top. */
/** @returns {Config} */
const getConfig = () => ({ ...defaults, ...pickValid(read()) });

/** Persists the overridable keys from `config` and returns the merged config. */
/** @param {Partial<Config>} config @returns {Config} */
const saveConfig = (config) => {
  write(pickValid(config));
  return getConfig();
};

/** Deletes all overrides so the defaults from config.js apply again. */
const resetConfig = () => {
  write({});
  return getConfig();
};

module.exports = {
  defaults,
  isValidUrl,
  getConfig,
  saveConfig,
  resetConfig,
  hasSavedConfig,
};
