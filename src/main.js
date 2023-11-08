"use strict";
const { app, BrowserWindow, globalShortcut } = require("electron");
const path = require("path");
const Config = require("../config");

const APP_PATH = app.getAppPath();
const INDEX_PATH = path.join(APP_PATH, "index.html");
const now = Date.now();
const TAG = "[MAIN]: ";
const program = async () => {
  try {
    await app.whenReady();
  } catch (e) {
    console.log(e);
  }

  const { screen } = require("electron");
  const display = screen.getPrimaryDisplay();
  const { height, width } = display.bounds;

  console.log(TAG + "height=", height);
  console.log(TAG + "width=", width);

  const webWindow = new BrowserWindow({
    width: width,
    height: height,
    frame: false,
    fullscreen: true,
    kiosk: true,
    backgroundColor: "#000000",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: true,
    },
  });

  /** @param {object} message*/
  const sendMessage = (message) => {
    if (webWindow.isDestroyed()) return;
    if (!webWindow.webContents) return;

    const asJson = JSON.stringify(message);
    const code = `
    (function () {
        const customEvent = new CustomEvent("fromMain", { detail: ${asJson}});
        window.dispatchEvent(customEvent);
     })();`;

    webWindow.webContents
      .executeJavaScript(code, true)
      .then(() => {
        // console.log("SENT");
      })
      .catch((e) => {
        console.log(e);
      });
  };

  webWindow
    .loadFile(INDEX_PATH)
    .then(() => {
      if (Config.devtools) {
        webWindow.webContents.openDevTools();
      }
      const loadTime = Date.now() - now;
      console.log("[MAIN]: webWindow loaded in: " + loadTime + "ms");
      sendMessage({ kind: "tick" });
    })
    .catch((e) => {
      console.log(e);
    });

  setTimeout(() => {
    webWindow.show();
  }, 100);

  globalShortcut.register("CommandOrControl+a", () => {
    console.log("CommandOrControl+a");
    sendMessage({ kind: "toggle-admin" });
  });

  globalShortcut.register("CommandOrControl+q", () => {
    app.quit();
  });

  globalShortcut.register("CommandOrControl+d", () => {
    webWindow.webContents.toggleDevTools();
  });

  globalShortcut.register("CommandOrControl+n", () => {
    sendMessage({ kind: "keyboard-event", key: "n" });
  });

  globalShortcut.register("CommandOrControl+b", () => {
    sendMessage({ kind: "keyboard-event", key: "b" });
  });

  globalShortcut.register("CommandOrControl+f", () => {
    sendMessage({ kind: "keyboard-event", key: "f" });
  });

  setInterval(() => {
    sendMessage({ kind: "tick" });
  }, 1000);
};

program()
  .then(() => {})
  .catch((e) => {
    console.log(e);
  });

app.on("window-all-closed", () => {
  app.quit();
});
