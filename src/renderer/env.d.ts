interface ForgeboardBridge {
  ping: () => Promise<{ app: string; version: string }>;
}

interface Window {
  forgeboard: ForgeboardBridge;
}
