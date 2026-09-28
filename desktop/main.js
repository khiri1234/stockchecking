// The H Stock Management for Windows and macOS: opens the dashboard in its own window.
// Pages are served from the bundled app/ folder over an app:// address, which
// behaves like a normal website origin (so Firebase sign-in and the offline
// cache work) while needing no web server.
const { app, BrowserWindow, Menu, nativeTheme, protocol, net, shell } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

const APP_ROOT = path.join(__dirname, "app");
const START_URL = "app://stockcheck/dashboard.html";

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

// One window only: opening the app again brings the existing window forward
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: "The H Stock Management",
    backgroundColor: "#EDEFF2",
    icon: path.join(__dirname, "build", "icon.png"),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  win.once("ready-to-show", () => win.show());
  // On macOS closing the window leaves the app running in the Dock
  win.on("closed", () => { win = null; });

  // Web links (privacy policy, etc.) open in the normal browser, not in the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("app://")) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  win.loadURL(START_URL);
}

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

// macOS always shows a menu bar: keep it to the standard app, edit (copy and
// paste), view (zoom) and window menus
function macMenu() {
  return Menu.buildFromTemplate([
    { role: "appMenu" },
    { role: "editMenu" },
    { label: "View", submenu: [
      { role: "reload" },
      { type: "separator" },
      { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" }
    ] },
    { role: "windowMenu" }
  ]);
}

app.whenReady().then(() => {
  // Always light, like the phone app, even when the computer is in dark mode
  nativeTheme.themeSource = "light";
  if (process.platform === "darwin") Menu.setApplicationMenu(macMenu());
  protocol.handle("app", (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(APP_ROOT, decodeURIComponent(pathname)));
    if (!file.startsWith(APP_ROOT + path.sep)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
