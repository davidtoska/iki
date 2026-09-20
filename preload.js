"use strict";
const { ipcRenderer } = require("electron");

/** @typedef {import("./db").Config} Config */
/** @typedef {import("./main").AdminMessage} AdminMessage */

const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  #admin-panel {
    --bg: #0d1117;
    --surface: #161b22;
    --field: #0d1117;
    --border: #30363d;
    --text: #e6edf3;
    --muted: #8b949e;
    --accent: #2f81f7;
    --ok: #3fb950;
    --bad: #f85149;

    display: none;
    position: fixed;
    inset: 0;
    align-items: center;
    justify-content: center;
    background: rgba(1, 4, 9, 0.8);
    backdrop-filter: blur(4px);
    z-index: 2147483647;
    font: 14px/1.4 system-ui, "Segoe UI", Roboto, sans-serif;
    color: var(--text);
  }

  .card {
    width: 640px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    overflow: auto;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 20px 24px;
    border-bottom: 1px solid var(--border);
  }
  h1 { font-size: 18px; font-weight: 600; letter-spacing: 0.2px; }
  .subtitle { margin-top: 2px; color: var(--muted); font-size: 12px; }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }
  .pill::before {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--bad);
  }
  .pill.online::before { background: var(--ok); box-shadow: 0 0 6px var(--ok); }

  .body { display: grid; gap: 24px; padding: 24px; }
  section { display: grid; gap: 16px; }
  h2 {
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

  .field { display: grid; gap: 6px; align-content: start; }
  .field > span:first-child { font-size: 13px; font-weight: 500; }
  .hint { color: var(--muted); font-size: 12px; }

  input[type="text"], input[type="number"] {
    width: 100%;
    padding: 9px 12px;
    color: var(--text);
    background: var(--field);
    border: 1px solid var(--border);
    border-radius: 6px;
    font: inherit;
    outline: none;
  }
  input[type="text"]:focus, input[type="number"]:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(47, 129, 247, 0.25);
  }

  .toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 14px;
    background: var(--field);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
  }
  .toggle .field-text { display: grid; gap: 2px; }
  .toggle .field-text span:first-child { font-weight: 500; }
  input[type="checkbox"] {
    appearance: none;
    position: relative;
    flex: none;
    width: 38px;
    height: 22px;
    border-radius: 999px;
    background: var(--border);
    cursor: pointer;
    transition: background 0.15s;
  }
  input[type="checkbox"]::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
  }
  input[type="checkbox"]:checked { background: var(--accent); }
  input[type="checkbox"]:checked::after { transform: translateX(16px); }
  input[type="checkbox"]:focus-visible { box-shadow: 0 0 0 3px rgba(47, 129, 247, 0.4); }

  footer {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 24px;
    border-top: 1px solid var(--border);
    background: rgba(255, 255, 255, 0.02);
  }
  .message { flex: 1; color: var(--bad); font-size: 13px; }

  button {
    padding: 8px 16px;
    color: var(--text);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }
  button:hover { border-color: var(--muted); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.primary:hover { filter: brightness(1.1); }
`;

/**
 * Typed element factory: the tag name decides which props are allowed.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Partial<HTMLElementTagNameMap[K]>} [props]
 * @param {(Node | string)[]} [children]
 * @returns {HTMLElementTagNameMap[K]}
 */
const h = (tag, props, children = []) => {
  const el = document.createElement(tag);
  Object.assign(el, props);
  el.append(...children);
  return el;
};

/**
 * @param {string} label
 * @param {HTMLInputElement} input
 * @param {string} [hint]
 */
const field = (label, input, hint) =>
  h("label", { className: "field" }, [
    h("span", { textContent: label }),
    input,
    ...(hint ? [h("span", { className: "hint", textContent: hint })] : []),
  ]);

/**
 * @param {string} label
 * @param {string} hint
 * @param {HTMLInputElement} input
 */
const toggle = (label, hint, input) =>
  h("label", { className: "toggle" }, [
    h("div", { className: "field-text" }, [
      h("span", { textContent: label }),
      h("span", { className: "hint", textContent: hint }),
    ]),
    input,
  ]);

const buildPanel = () => {
  const inputs = {
    url: h("input", { type: "text" }),
    username: h("input", { type: "text" }),
    deviceId: h("input", { type: "text" }),
    ackString: h("input", { type: "text" }),
    reloadAfterSec: h("input", { type: "number", min: "1" }),
    devtools: h("input", { type: "checkbox" }),
    kiosk: h("input", { type: "checkbox" }),
  };
  const onlineEl = h("span", { className: "pill" });
  const statusEl = h("div", { className: "message" });
  const updateBtn = h("button", {
    className: "primary",
    textContent: "Save & reload",
  });
  const resetBtn = h("button", { textContent: "Reset to defaults" });

  const panel = h("div", { id: "admin-panel" }, [
    h("div", { className: "card" }, [
      h("header", {}, [
        h("div", {}, [
          h("h1", { textContent: "Device settings" }),
          h("div", {
            className: "subtitle",
            textContent: "Ctrl+A closes this panel",
          }),
        ]),
        onlineEl,
      ]),
      h("div", { className: "body" }, [
        h("section", {}, [
          h("h2", { textContent: "Connection" }),
          field("Url", inputs.url),
          h("div", { className: "row" }, [
            field(
              "Ack string",
              inputs.ackString,
              "Empty disables the watchdog",
            ),
            field(
              "Reload after (sec)",
              inputs.reloadAfterSec,
              "Reload if no ack is received",
            ),
          ]),
        ]),
        h("section", {}, [
          h("h2", { textContent: "Device" }),
          h("div", { className: "row" }, [
            field("Username", inputs.username),
            field("Device ID", inputs.deviceId),
          ]),
        ]),
        h("section", {}, [
          h("h2", { textContent: "Display" }),
          toggle("Kiosk mode", "Fullscreen, locked-down window", inputs.kiosk),
          toggle("Developer tools", "Ctrl+D toggles them", inputs.devtools),
        ]),
      ]),
      h("footer", {}, [statusEl, resetBtn, updateBtn]),
    ]),
  ]);

  const host = h("div", { id: "iki-admin-host" });
  // Closed shadow root: page scripts can neither restyle nor reach into the panel.
  host
    .attachShadow({ mode: "closed" })
    .append(h("style", { textContent: STYLE }), panel);

  /** @param {Partial<Config>} c */
  const fillForm = (c) => {
    inputs.url.value = c.url ?? "";
    inputs.username.value = c.username ?? "";
    inputs.deviceId.value = c.deviceId ?? "";
    inputs.ackString.value = c.ackString ?? "";
    inputs.reloadAfterSec.value = c.reloadAfterSec?.toString() ?? "";
    inputs.devtools.checked = c.devtools ?? false;
    inputs.kiosk.checked = c.kiosk ?? false;
  };

  /** @returns {Config} */
  const readForm = () => ({
    url: inputs.url.value,
    username: inputs.username.value,
    deviceId: inputs.deviceId.value,
    ackString: inputs.ackString.value,
    reloadAfterSec: inputs.reloadAfterSec.valueAsNumber,
    devtools: inputs.devtools.checked,
    kiosk: inputs.kiosk.checked,
  });

  const isOpen = () => panel.style.display === "flex";

  const open = async () => {
    fillForm(/** @type {Config} */ (await ipcRenderer.invoke("config:get")));
    statusEl.textContent = "";
    panel.style.display = "flex";
  };

  const close = () => {
    fillForm({});
    panel.style.display = "none";
  };

  /** The main process saves and reloads the page; we only show a failure. */
  const run = async (/** @type {() => Promise<Config>} */ action) => {
    try {
      fillForm(await action());
      statusEl.textContent = "";
    } catch (e) {
      statusEl.textContent = e instanceof Error ? e.message : String(e);
    }
  };
  updateBtn.onclick = () =>
    run(() => ipcRenderer.invoke("config:save", readForm()));
  resetBtn.onclick = () => run(() => ipcRenderer.invoke("config:reset"));

  const updateOnline = () => {
    onlineEl.textContent = navigator.onLine ? "Online" : "Offline";
    onlineEl.classList.toggle("online", navigator.onLine);
  };
  window.addEventListener("online", updateOnline);
  window.addEventListener("offline", updateOnline);
  updateOnline();

  document.body.appendChild(host);
  return { open, close, isOpen };
};

/** @type {ReturnType<typeof buildPanel> | undefined} */
let panel;

window.addEventListener("DOMContentLoaded", () => {
  panel = buildPanel();
});

// The page is the top-level window, so a page's `window.parent.postMessage(ack)` lands
// on its own window. Forward strings to main, which owns the watchdog.
window.addEventListener("message", (e) => {
  if (typeof e.data === "string") ipcRenderer.send("page-message", e.data);
});

ipcRenderer.on("fromMain", (_e, /** @type {AdminMessage} */ message) => {
  switch (message.kind) {
    case "toggle-admin":
      if (panel?.isOpen()) panel.close();
      else panel?.open();
      break;
    case "open-admin":
      panel?.open();
      break;
  }
});
