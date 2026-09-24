import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("forgeboard", {
  ping: () => ipcRenderer.invoke("app:ping"),
});
