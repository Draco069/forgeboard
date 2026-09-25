import type { ForgeboardApi } from "../shared/types";

declare global {
  interface Window {
    forgeboard: ForgeboardApi;
  }
}

export {};
