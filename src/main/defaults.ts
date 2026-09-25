import { randomUUID } from "node:crypto";
import type { StoreDocument, Workspace } from "../shared/types";

export function createDefaultWorkspace(now = new Date().toISOString()): Workspace {
  return {
    id: randomUUID(),
    name: "Personal workspace",
    createdAt: now,
    updatedAt: now,
  };
}

export function createDefaultDocument(): StoreDocument {
  const now = new Date().toISOString();
  const workspace = createDefaultWorkspace(now);

  return {
    schemaVersion: 1,
    workspaces: [workspace],
    prompts: [],
    connections: [],
    requests: [],
    settings: { theme: "system" },
    activeWorkspaceId: workspace.id,
  };
}
