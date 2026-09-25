import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";
import type { ForgeboardApi } from "../src/shared/types";

afterEach(() => {
  cleanup();
});

describe("App shell", () => {
  it("renders the desktop shell", async () => {
    const forgeboard: ForgeboardApi = {
      ping: vi.fn().mockResolvedValue({ app: "Forgeboard", version: "0.1.0" }),
      getState: vi.fn(),
      createWorkspace: vi.fn(),
      renameWorkspace: vi.fn(),
      deleteWorkspace: vi.fn(),
      setActiveWorkspace: vi.fn(),
      savePrompt: vi.fn(),
      deletePrompt: vi.fn(),
      saveConnection: vi.fn(),
      deleteConnection: vi.fn(),
      updateSettings: vi.fn(),
      runRequest: vi.fn(),
      cancelRequest: vi.fn(),
      exportData: vi.fn(),
      importData: vi.fn(),
      onRunEvent: vi.fn(() => () => undefined),
    };
    window.forgeboard = forgeboard;

    render(<App />);

    expect(await screen.findByText("Forgeboard")).toBeInTheDocument();
    expect(await screen.findByText(/Ready · version 0\.1\.0/)).toBeInTheDocument();
  });
});
