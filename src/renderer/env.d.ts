interface ForgeboardBridge {
  ping: () => Promise<import("../shared/types").AppPing>;
}

interface Window {
  forgeboard: ForgeboardBridge;
}
