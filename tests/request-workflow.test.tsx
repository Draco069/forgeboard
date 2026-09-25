import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";
import { ComparisonView } from "../src/renderer/components/ComparisonView";
import { ConnectionDialog } from "../src/renderer/components/ConnectionDialog";
import { ErrorNotice } from "../src/renderer/components/ErrorNotice";
import { HistoryList } from "../src/renderer/components/HistoryList";
import { ResponseViewer } from "../src/renderer/components/ResponseViewer";
import { RunPanel } from "../src/renderer/components/RunPanel";
import type {
  AppError,
  AppState,
  Connection,
  ForgeboardApi,
  Prompt,
  RequestRecord,
  RunEventListener,
} from "../src/shared/types";

const now = "2026-09-25T12:00:00.000Z";
const workspace = {
  id: "workspace-1",
  name: "Personal workspace",
  createdAt: now,
  updatedAt: now,
};

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "connection-1",
    name: "Local Ollama",
    provider: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    model: "llama3.2",
    hasCredential: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function prompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: "prompt-1",
    workspaceId: workspace.id,
    title: "Explain a concept",
    description: "",
    body: "Explain {{topic}} for a new developer.",
    tags: [],
    favorite: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function request(overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    id: "request-1",
    workspaceId: workspace.id,
    promptId: "prompt-1",
    connectionId: "connection-1",
    provider: "ollama",
    model: "llama3.2",
    renderedPrompt: "Explain recursion for a new developer.",
    response: "Recursion is a function calling itself.",
    status: "success",
    durationMs: 420,
    createdAt: now,
    ...overrides,
  };
}

function state(overrides: Partial<AppState["document"]> = {}, prompts: Prompt[] = []): AppState {
  return {
    document: {
      schemaVersion: 1,
      workspaces: [workspace],
      prompts,
      connections: [],
      requests: [],
      settings: { theme: "system" },
      activeWorkspaceId: workspace.id,
      ...overrides,
    },
    activeWorkspace: workspace,
    credentialsAvailable: true,
  };
}

function appError(code: AppError["code"], detail?: string): AppError {
  return {
    code,
    message:
      code === "AUTHENTICATION"
        ? "The provider rejected the credentials."
        : code === "TIMEOUT"
          ? "The request timed out."
          : "Something went wrong.",
    ...(detail ? { detail } : {}),
    retryable: code !== "AUTHENTICATION",
  };
}

function bridgeFor(
  initialState: AppState,
  runRequest: ForgeboardApi["runRequest"],
  onRunEvent: (listener: RunEventListener) => () => void = vi.fn(() => () => undefined),
): ForgeboardApi {
  return {
    ping: vi.fn().mockResolvedValue({ app: "Forgeboard", version: "0.1.0" }),
    getState: vi.fn().mockResolvedValue(initialState),
    createWorkspace: vi.fn(),
    renameWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    setActiveWorkspace: vi.fn(),
    savePrompt: vi.fn(),
    deletePrompt: vi.fn(),
    saveConnection: vi.fn(),
    deleteConnection: vi.fn(),
    updateSettings: vi.fn(),
    runRequest,
    cancelRequest: vi.fn().mockResolvedValue(true),
    exportData: vi.fn(),
    importData: vi.fn(),
    onRunEvent,
  } as ForgeboardApi;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("request workflow", () => {
  it("validates and saves a masked connection through the bridge callback", async () => {
    const onSave = vi.fn().mockResolvedValue(connection({ hasCredential: true }));
    const onClose = vi.fn();
    const user = userEvent.setup();

    const { unmount } = render(
      <ConnectionDialog
        onClose={onClose}
        onSave={onSave}
        open
      />,
    );

    expect(screen.getByLabelText("Provider")).toHaveValue("ollama");
    expect(screen.getByLabelText("Base URL")).toHaveValue("http://127.0.0.1:11434");
    expect(screen.getByLabelText("Model")).toHaveValue("llama3.2");
    expect(screen.getByLabelText(/Credential/)).toHaveAttribute("type", "password");

    await user.type(screen.getByLabelText("Connection name"), "Local model");
    await user.type(screen.getByLabelText(/Credential/), "transient-secret");
    await user.click(screen.getByRole("button", { name: "Add connection" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        name: "Local model",
        provider: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        model: "llama3.2",
        credential: "transient-secret",
      }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByDisplayValue("transient-secret")).not.toBeInTheDocument();
    unmount();

    const invalidSave = vi.fn();
    render(
      <ConnectionDialog
        onSave={invalidSave}
        open
      />,
    );
    await user.clear(screen.getByLabelText("Base URL"));
    await user.type(screen.getByLabelText("Base URL"), "not-a-url");
    await user.type(screen.getByLabelText("Connection name"), "Bad endpoint");
    await user.click(screen.getByRole("button", { name: "Add connection" }));
    expect(await screen.findByText("Enter an absolute HTTP or HTTPS provider URL.")).toBeInTheDocument();
    expect(invalidSave).not.toHaveBeenCalled();
  });

  it("runs a selected prompt with rendered variables and shows streamed deltas", async () => {
    let listener: RunEventListener | undefined;
    const savedPrompt = prompt();
    const savedConnection = connection();
    const runRequest = vi.fn(async (input) => {
      const requestId = "request-stream";
      listener?.({
        type: "started",
        requestId,
        createdAt: now,
        workspaceId: workspace.id,
        promptId: savedPrompt.id,
        connectionId: savedConnection.id,
        provider: savedConnection.provider,
        model: savedConnection.model,
      });
      listener?.({ type: "delta", requestId, text: "A function " });
      listener?.({ type: "delta", requestId, text: "that calls itself." });
      return request({
        id: requestId,
        response: "A function that calls itself.",
        renderedPrompt: input.renderedPrompt,
      });
    });
    const bridge = bridgeFor(
      state({ connections: [savedConnection] }, [savedPrompt]),
      runRequest,
      (nextListener) => {
        listener = nextListener;
        return () => undefined;
      },
    );
    window.forgeboard = bridge;
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("Explain a concept");
    const promptButton = screen.getByText("Explain a concept").closest("button");
    expect(promptButton).not.toBeNull();
    await user.click(promptButton as HTMLElement);
    await user.type(screen.getByLabelText(/topic/), "recursion");
    await user.click(screen.getByRole("button", { name: "Run prompt" }));

    await waitFor(() => expect(runRequest).toHaveBeenCalledTimes(1));
    expect(runRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: workspace.id,
        promptId: savedPrompt.id,
        connectionId: savedConnection.id,
        renderedPrompt: "Explain recursion for a new developer.",
        stream: true,
      }),
    );
    expect(await screen.findByTestId("response-text")).toHaveTextContent(
      "A function that calls itself.",
    );
    expect(screen.getByTestId("response-status")).toHaveTextContent("Completed");
  });

  it("cancels an active run without clearing the prompt draft", async () => {
    const onCancel = vi.fn().mockResolvedValue(true);
    const onRun = vi.fn();
    const user = userEvent.setup();

    render(
      <RunPanel
        activeRun={{
          requestId: "request-active",
          workspaceId: workspace.id,
          promptId: "prompt-1",
          connectionId: "connection-1",
          provider: "ollama",
          model: "llama3.2",
          createdAt: now,
          response: "partial",
          status: "running",
        }}
        connections={[connection()]}
        onCancel={onCancel}
        onRun={onRun}
        prompt={prompt()}
        variableValues={{ topic: "recursion" }}
      />,
    );

    expect(screen.getByRole("button", { name: "Cancel request" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Cancel request" }));
    expect(onCancel).toHaveBeenCalledWith("request-active");
    expect(screen.getByLabelText(/topic/)).toHaveValue("recursion");
    expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled();
  });

  it("shows safe authentication and timeout details without rendering raw HTML", () => {
    const { rerender } = render(
      <ErrorNotice
        error={appError("AUTHENTICATION", "Bearer [REDACTED]")}
      />,
    );
    expect(screen.getByText("The provider rejected the credentials.")).toBeInTheDocument();
    expect(screen.getByText("Bearer [REDACTED]")).toBeInTheDocument();
    expect(screen.queryByText("Show technical details")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("<script");

    rerender(<ErrorNotice error={appError("TIMEOUT", "The request exceeded its timeout.")} />);
    expect(screen.getByText("The request timed out.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("groups history by date and opens a two-record comparison", async () => {
    const first = request({
      id: "request-1",
      model: "llama3.2",
      createdAt: "2026-09-24T10:00:00.000Z",
      response: "First answer",
    });
    const second = request({
      id: "request-2",
      model: "llama3.2",
      createdAt: "2026-09-25T10:00:00.000Z",
      response: "Second answer",
    });
    const onCompare = vi.fn();
    const user = userEvent.setup();

    render(<HistoryList onCompare={onCompare} requests={[first, second]} />);

    expect(screen.getByRole("heading", { name: /25.*2026/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /24.*2026/ })).toBeInTheDocument();
    expect(screen.getByText("First answer")).toBeInTheDocument();
    expect(screen.getByText("Second answer")).toBeInTheDocument();

    await user.click(screen.getAllByRole("checkbox")[1]);
    await user.click(screen.getAllByRole("checkbox")[0]);

    expect(onCompare).toHaveBeenCalledWith(first, second);
  });

  it("renders side-by-side comparison details and supports accessible copy", async () => {
    const left = request({ id: "left", model: "model-a", response: "Answer A" });
    const right = request({ id: "right", model: "model-b", response: "Answer B" });
    const copy = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();

    render(<ComparisonView left={left} onCopy={copy} right={right} />);

    expect(screen.getByRole("dialog", { name: "Compare two responses" })).toBeInTheDocument();
    expect(screen.getByText("Answer A")).toBeInTheDocument();
    expect(screen.getByText("Answer B")).toBeInTheDocument();
    expect(screen.getByText("model-a")).toBeInTheDocument();
    expect(screen.getByText("model-b")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy response a response" }));
    expect(copy).toHaveBeenCalledWith("Answer A");
    expect(screen.getAllByText("Response copied.").length).toBeGreaterThan(0);
  });

  it("keeps response text selectable and never interprets it as markup", () => {
    const record = request({ response: "<script>alert('x')</script>" });
    render(<ResponseViewer record={record} />);

    const response = screen.getByTestId("response-text");
    expect(response).toHaveTextContent("<script>alert('x')</script>");
    expect(response.querySelector("script")).toBeNull();
    expect(response).toHaveClass("response-text");
  });

  it("refreshes history after a terminal run event", async () => {
    let listener: RunEventListener | undefined;
    const terminal = request({ id: "request-terminal", response: "stored" });
    const bridge = bridgeFor(
      state({ connections: [connection()] }, [prompt()]),
      vi.fn(async () => terminal),
      (nextListener) => {
        listener = nextListener;
        return () => undefined;
      },
    );
    window.forgeboard = bridge;
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("Explain a concept");
    const promptButton = screen.getByText("Explain a concept").closest("button");
    expect(promptButton).not.toBeNull();
    await user.click(promptButton as HTMLElement);
    await user.type(screen.getByLabelText(/topic/), "recursion");
    await user.click(screen.getByRole("button", { name: "Run prompt" }));

    await waitFor(() => expect(listener).toBeDefined());
    act(() => {
      listener?.({
        type: "completed",
        requestId: terminal.id,
        record: terminal,
      });
    });
    expect((await screen.findAllByText("stored")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /History/ }));
    expect((await screen.findAllByText("stored")).length).toBeGreaterThan(0);
  });
});
