import { join } from "node:path";
import { app, BrowserWindow } from "electron";
import { SafeStorageCredentialVault } from "./credentials";
import { registerIpcHandlers } from "./ipc";
import { RequestService } from "./request-service";
import { ForgeboardStore } from "./store";

let mainWindow: BrowserWindow | undefined;
let startupPromise: Promise<void> | undefined;

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: "#f4f1ea",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;

  window.once("ready-to-show", () => {
    window.show();
  });
  window.once("closed", () => {
    if (mainWindow === window) {
      mainWindow = undefined;
    }
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  window.webContents.on("will-redirect", (event) => {
    event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && rendererUrl) {
    void window.loadURL(rendererUrl);
    return;
  }

  void window.loadFile(join(__dirname, "../renderer/index.html"));
}

async function initializeMainProcess(): Promise<void> {
  if (startupPromise) {
    return startupPromise;
  }

  startupPromise = (async () => {
    const userData = app.getPath("userData");
    const credentials = new SafeStorageCredentialVault(userData);
    const store = new ForgeboardStore(userData, credentials);

    // Do not register state or mutation handlers until the persisted document
    // has been loaded and any recovery notice is known.
    await store.load();
    const requestService = new RequestService(store);
    registerIpcHandlers({
      store,
      credentials,
      requestService,
      getWindow: () => mainWindow,
    });
  })();

  return startupPromise;
}

void app
  .whenReady()
  .then(async () => {
    await initializeMainProcess();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  })
  .catch(() => {
    // Startup failures should not expose implementation details to a renderer.
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
