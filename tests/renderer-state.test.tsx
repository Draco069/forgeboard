import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";
import { useForgeboard } from "../src/renderer/hooks/useForgeboard";
import type {
  AppState,
  ForgeboardApi,
  RunEvent,
  RunEventListener,
} from "../src/shared/types";

afterEach(() => {
  cleanup();
});

const now = "2026-09-25T12:00:00.000Z";

function createState(): AppState {
  return {
    document: {
      schemaVersion: 1,
      workspaces: [
        {
          id: "workspace-1",
          name: "Frontend desk",
          createdAt: now,
          updatedAt: now,
        },
      ],
      prompts: [],
      connections: [],
      requests: [],
      settings: { theme: "system" },
      activeWorkspaceId: "workspace-1",
    },
    activeWorkspace: {
      id: "workspace-1",
      name: "Frontend desk",
      createdAt: now,
      updatedAt: now,
    },
    credentialsAvailable: true,
  };
}

function createBridge(
  state: AppState,
  onRunEvent: (listener: RunEventListener) => () => void = vi.fn(() => () => undefined),
): ForgeboardApi {
  return {
    ping: vi.fn().mockResolvedValue({ app: "Forgeboard", version: "0.1.0" }),
    getState: vi.fn().mockResolvedValue(state),
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
    onRunEvent,
  } as ForgeboardApi;
}

function StateProbe() {
  const { state } = useForgeboard();
  return (
    <output data-testid="state-probe">
      {JSON.stringify({
        workspace: state?.activeWorkspace.name,
        view: state?.view,
        activeRun: state?.activeRun,
        activeRuns: state?.activeRuns,
      })}
    </output>
  );
}

describe("Forgeboard renderer state", () => {
  it("loads the active workspace and renders the three-region shell", async () => {
    const bridge = createBridge(createState());
    window.forgeboard = bridge;

    render(<App />);

    expect(await screen.findByRole("complementary", { name: "Forgeboard workspace navigation" })).toBeInTheDocument();
    expect(await screen.findByRole("banner")).toBeInTheDocument();
    expect(await screen.findByRole("main")).toBeInTheDocument();
    expect((await screen.findAllByText("Frontend desk")).length).toBeGreaterThan(0);
    expect(await screen.findByRole("button", { name: /Prompts/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(await screen.findByRole("button", { name: /Create your first prompt/ })).toBeInTheDocument();
    expect(bridge.getState).toHaveBeenCalledTimes(1);
  });

  it("updates only the run identified by a RunEvent", async () => {
    let listener: RunEventListener | undefined;
    const unsubscribe = vi.fn();
    const bridge = createBridge(createState(), (nextListener) => {
      listener = nextListener;
      return unsubscribe;
    });
    window.forgeboard = bridge;

    render(<StateProbe />);
    await screen.findByText(/"workspace":"Frontend desk"/);

    const started = (requestId: string): RunEvent => ({
      type: "started",
      requestId,
      createdAt: now,
      workspaceId: "workspace-1",
      connectionId: "connection-1",
      provider: "ollama",
      model: `model-${requestId}`,
    });

    act(() => {
      listener?.(started("request-a"));
      listener?.(started("request-b"));
      listener?.({ type: "delta", requestId: "request-b", text: "only b" });
    });

    const probe = screen.getByTestId("state-probe");
    expect(probe).toHaveTextContent("only b");
    expect(probe).not.toHaveTextContent("only a");
    const parsed = JSON.parse(probe.textContent ?? "{}") as {
      activeRun: { requestId: string; response: string };
      activeRuns: Record<string, { response: string }>;
    };
    expect(parsed.activeRun.requestId).toBe("request-b");
    expect(parsed.activeRun.response).toBe("only b");
    expect(parsed.activeRuns["request-a"].response).toBe("");
  });

  it("cleans up the run subscription when the renderer unmounts", async () => {
    const unsubscribe = vi.fn();
    const bridge = createBridge(createState(), vi.fn(() => unsubscribe));
    window.forgeboard = bridge;

    const { unmount } = render(<StateProbe />);
    await screen.findByText(/"workspace":"Frontend desk"/);
    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
