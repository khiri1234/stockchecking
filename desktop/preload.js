// Tells the shared web code (common.js) it is running inside the desktop app
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("desktopApp", { platform: process.platform });
