"use strict";
const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  powerSaveBlocker,
  screen,
} = require("electron");
const path = require("path");
const Db = require("./db");

const TAG = "[MAIN]: ";
const TICK_MS = 1000;
const RETRY_MS = 5000;
/** Failed loads in a row before a broken saved url is replaced by the default (not persisted). */
const FAILS_BEFORE_FALLBACK = 3;
const UNRESPONSIVE_KILL_MS = 10000;
/** Ctrl/Cmd+<key> shortcuts that are forwarded to the page as keyboard events. */
const PAGE_KEYS = ["n", "b", "f"];

/**
 * Sent to the preload over IPC ("fromMain").
 * @typedef {{ kind: "toggle-admin" } | { kind: "open-admin" }} AdminMessage
 */

/**
 * Posted to the page with window.postMessage (see sendToPage).
 * @typedef {{ kind: "keyboard-event", key: string }
 *   | { kind: "tick", username: string, deviceId: string, ackString: string }} PageMessage
 */

const start = async () => {
  await app.whenReady();

  let config = Db.getConfig();
  console.log(TAG + "config", config);

  /** Open the admin panel once per app start if nothing has been configured yet. */
  let openAdminOnce = !Db.hasSavedConfig();
  let lastAckAt = Date.now();
  let failedLoads = 0;
  let fallbackActive = false;
  /** @type {NodeJS.Timeout | undefined} */
  let retryTimer;
  /** @type {NodeJS.Timeout | undefined} */
  let unresponsiveTimer;

  const { width, height } = screen.getPrimaryDisplay().bounds;
  const win = new BrowserWindow({
    width: config.kiosk ? width : Math.floor(width / 2),
    height,
    frame: false,
    kiosk: config.kiosk,
    backgroundColor: "#000000",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  const wc = win.webContents;

  /** @param {AdminMessage} message */
  const send = (message) => {
    if (!win.isDestroyed()) wc.send("fromMain", message);
  };

  /**
   * Runs in the page's own world with a user gesture, so the page may e.g. start
   * media or enter fullscreen in response to a keyboard event.
   * @param {PageMessage} message
   */
  const sendToPage = (message) => {
    if (win.isDestroyed()) return;
    const code = `window.postMessage(${JSON.stringify(message)}, "*")`;
    wc.executeJavaScript(code, true).catch((e) =>
      console.log(TAG + "executeJavaScript", e),
    );
  };

  const targetUrl = () => (fallbackActive ? Db.defaults.url : config.url);

  const loadUrl = () => {
    clearTimeout(retryTimer);
    lastAckAt = Date.now();
    wc.loadURL(targetUrl()).catch((e) =>
      console.log(TAG + "loadURL", e.code ?? e),
    );
  };

  const applyWindowSettings = () => {
    if (win.isKiosk() !== config.kiosk) win.setKiosk(config.kiosk);
    if (config.devtools && !wc.isDevToolsOpened()) wc.openDevTools();
    if (!config.devtools && wc.isDevToolsOpened()) wc.closeDevTools();
  };

  /** Called after the config was saved or reset. */
  const onConfigChanged = () => {
    fallbackActive = false;
    failedLoads = 0;
    applyWindowSettings();
    loadUrl();
  };

  // --- IPC (config lives here, the preload only asks for it) -----------------
  ipcMain.handle("config:get", () => config);

  ipcMain.handle("config:save", (_e, edited) => {
    if (edited?.url && !Db.isValidUrl(edited.url))
      throw new Error("Invalid url (use http/https)");
    config = Db.saveConfig(edited);
    onConfigChanged();
    return config;
  });

  ipcMain.handle("config:reset", () => {
    config = Db.resetConfig();
    onConfigChanged();
    return config;
  });

  ipcMain.on("page-message", (_e, data) => {
    if (config.ackString && data === config.ackString) lastAckAt = Date.now();
  });

  // --- Global shortcuts (also fire when the window is not focused) ----------
  /** @type {Record<string, () => void>} */
  const shortcuts = {
    "CommandOrControl+Q": () => app.quit(),
    "CommandOrControl+A": () => send({ kind: "toggle-admin" }),
    "CommandOrControl+D": () => {
      if (config.devtools) wc.toggleDevTools();
    },
  };
  for (const key of PAGE_KEYS) {
    shortcuts[`CommandOrControl+${key}`] = () =>
      sendToPage({ kind: "keyboard-event", key });
  }
  for (const [accelerator, handler] of Object.entries(shortcuts)) {
    if (!globalShortcut.register(accelerator, handler)) {
      console.log(TAG + "could not register " + accelerator);
    }
  }
  app.on("will-quit", () => globalShortcut.unregisterAll());

  // --- Keep the page on its own origin ---------------------------------------
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== new URL(targetUrl()).origin)
      event.preventDefault();
  });

  // --- Load, retry and recovery ----------------------------------------------
  wc.on("did-start-loading", () => {
    lastAckAt = Date.now();
  });

  wc.on("did-finish-load", () => {
    failedLoads = 0;
    lastAckAt = Date.now();
    if (openAdminOnce) {
      openAdminOnce = false;
      send({ kind: "open-admin" });
    }
  });

  wc.on("did-fail-load", (_e, code, description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3: aborted by a newer navigation
    failedLoads += 1;
    console.log(TAG + `load failed (${failedLoads}): ${description}`);

    if (
      failedLoads >= FAILS_BEFORE_FALLBACK &&
      config.url !== Db.defaults.url
    ) {
      console.log(
        TAG + "falling back to the default url so the admin panel is reachable",
      );
      fallbackActive = true;
    }
    retryTimer = setTimeout(loadUrl, RETRY_MS);
  });

  wc.on("render-process-gone", (_e, details) => {
    console.log(TAG + "render process gone: " + details.reason);
    loadUrl();
  });

  wc.on("unresponsive", () => {
    console.log(TAG + "page unresponsive");
    unresponsiveTimer = setTimeout(
      () => wc.forcefullyCrashRenderer(),
      UNRESPONSIVE_KILL_MS,
    );
  });
  wc.on("responsive", () => clearTimeout(unresponsiveTimer));

  // --- Tick: feeds the page and runs the ack watchdog ------------------------
  setInterval(() => {
    if (win.isDestroyed()) return;
    sendToPage({
      kind: "tick",
      username: config.username,
      deviceId: config.deviceId,
      ackString: config.ackString,
    });

    if (!config.ackString || failedLoads > 0 || wc.isLoading()) return;
    if ((Date.now() - lastAckAt) / 1000 > config.reloadAfterSec) {
      console.log(TAG + `no ack in ${config.reloadAfterSec}s, reloading`);
      loadUrl();
    }
  }, TICK_MS);

  powerSaveBlocker.start("prevent-display-sleep");
  app.on("second-instance", () => {
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  applyWindowSettings();
  const startedAt = Date.now();
  loadUrl();
  wc.once("did-finish-load", () =>
    console.log(TAG + `loaded in ${Date.now() - startedAt}ms`),
  );
};

if (app.requestSingleInstanceLock()) {
  start().catch((e) => console.log(TAG, e));
} else {
  app.quit();
}

app.on("window-all-closed", () => app.quit());
