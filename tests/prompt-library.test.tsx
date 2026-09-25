import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";
import type { AppState, ForgeboardApi, Prompt, Workspace } from "../src/shared/types";

const now = "2026-09-25T12:00:00.000Z";

function workspace(id: string, name: string): Workspace {
  return { id, name, createdAt: now, updatedAt: now };
}

function prompt(id: string, workspaceId: string, values: Partial<Prompt> = {}): Prompt {
  return {
    id,
    workspaceId,
    title: "Untitled prompt",
    description: "",
    body: "Write a useful response.",
    tags: [],
    favorite: false,
    createdAt: now,
    updatedAt: now,
    ...values,
  };
}

function createState(prompts: Prompt[] = [], workspaces: Workspace[] = [workspace("workspace-1", "Personal workspace")]): AppState {
  const activeWorkspace = workspaces[0];
  return {
    document: {
      schemaVersion: 1,
      workspaces,
      prompts,
      connections: [],
      requests: [],
      settings: { theme: "system" },
      activeWorkspaceId: activeWorkspace.id,
    },
    activeWorkspace,
    credentialsAvailable: true,
  };
}

function createBridge(initialState: AppState) {
  let currentState = initialState;
  const bridge: ForgeboardApi = {
    ping: vi.fn().mockResolvedValue({ app: "Forgeboard", version: "0.1.0" }),
    getState: vi.fn(async () => currentState),
    createWorkspace: vi.fn(async (nameOrInput) => {
      const name = typeof nameOrInput === "string" ? nameOrInput : nameOrInput.name;
      const created = workspace(`workspace-${currentState.document.workspaces.length + 1}`, name);
      currentState = {
        ...currentState,
        document: { ...currentState.document, workspaces: [...currentState.document.workspaces, created], activeWorkspaceId: created.id },
        activeWorkspace: created,
      };
      return created;
    }),
    renameWorkspace: vi.fn(async (idOrInput: string | { id: string; name: string }, name?: string) => {
      const id = typeof idOrInput === "string" ? idOrInput : idOrInput.id;
      const nextName = name ?? (typeof idOrInput === "string" ? "" : idOrInput.name);
      const renamed = { ...currentState.document.workspaces.find((item) => item.id === id)!, name: nextName };
      currentState = {
        ...currentState,
        document: {
          ...currentState.document,
          workspaces: currentState.document.workspaces.map((item) => (item.id === id ? renamed : item)),
        },
        activeWorkspace: currentState.activeWorkspace.id === id ? renamed : currentState.activeWorkspace,
      };
      return renamed;
    }) as ForgeboardApi["renameWorkspace"],
    deleteWorkspace: vi.fn(async (idOrInput) => {
      const id = typeof idOrInput === "string" ? idOrInput : idOrInput.id;
      const remaining = currentState.document.workspaces.filter((item) => item.id !== id);
      const activeWorkspace = remaining[0];
      currentState = {
        ...currentState,
        document: {
          ...currentState.document,
          workspaces: remaining,
          prompts: currentState.document.prompts.filter((item) => item.workspaceId !== id),
          activeWorkspaceId: activeWorkspace.id,
        },
        activeWorkspace,
      };
      return activeWorkspace;
    }),
    setActiveWorkspace: vi.fn(async (idOrInput) => {
      const id = typeof idOrInput === "string" ? idOrInput : idOrInput.id;
      const activeWorkspace = currentState.document.workspaces.find((item) => item.id === id)!;
      currentState = { ...currentState, activeWorkspace, document: { ...currentState.document, activeWorkspaceId: id } };
      return activeWorkspace;
    }),
    savePrompt: vi.fn(async (input) => {
      const saved = prompt(
        input.id ?? `prompt-${currentState.document.prompts.length + 1}`,
        input.workspaceId ?? currentState.activeWorkspace.id,
        input,
      );
      currentState = {
        ...currentState,
        document: {
          ...currentState.document,
          prompts: [...currentState.document.prompts.filter((item) => item.id !== saved.id), saved],
        },
      };
      return saved;
    }),
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
  return { bridge, getCurrentState: () => currentState };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("prompt library workflows", () => {
  it("creates and saves a prompt draft through the bridge", async () => {
    const { bridge } = createBridge(createState());
    window.forgeboard = bridge;
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("Reusable instructions, close at hand.");

    await user.click(screen.getByRole("button", { name: "Create your first prompt" }));
    await user.type(screen.getByLabelText("Prompt title"), "Release notes helper");
    await user.type(screen.getByLabelText("Prompt body"), "Turn these commits into release notes.");
    await user.click(screen.getByRole("button", { name: "Save prompt" }));

    await waitFor(() => expect(bridge.savePrompt).toHaveBeenCalledWith(expect.objectContaining({
      title: "Release notes helper",
      body: "Turn these commits into release notes.",
      workspaceId: "workspace-1",
    })));
  });

  it("searches by title and tag, and toggles favorites", async () => {
    const prompts = [
      prompt("prompt-1", "workspace-1", { title: "TypeScript review", tags: ["code", "review"] }),
      prompt("prompt-2", "workspace-1", { title: "Product brief", tags: ["writing"] }),
    ];
    const { bridge } = createBridge(createState(prompts));
    window.forgeboard = bridge;
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("TypeScript review");

    const search = screen.getByRole("searchbox", { name: "Search prompts" });
    await user.type(search, "product");
    expect(screen.getByText("Product brief")).toBeInTheDocument();
    expect(screen.queryByText("TypeScript review")).not.toBeInTheDocument();

    await user.clear(search);
    await user.click(screen.getByRole("button", { name: "Filter by writing" }));
    expect(screen.getByText("Product brief")).toBeInTheDocument();
    expect(screen.queryByText("TypeScript review")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All tags" }));
    await user.click(screen.getByRole("button", { name: "Add TypeScript review to favorites" }));
    await waitFor(() => expect(bridge.savePrompt).toHaveBeenCalledWith(expect.objectContaining({
      id: "prompt-1",
      favorite: true,
    })));
  });

  it("detects variables, preserves values while editing, and blocks incomplete saves", async () => {
    const { bridge } = createBridge(createState());
    window.forgeboard = bridge;
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("Reusable instructions, close at hand.");
    await user.click(screen.getByRole("button", { name: "Create your first prompt" }));

    await user.type(screen.getByLabelText("Prompt title"), "Explain a concept");
    const body = screen.getByLabelText("Prompt body");
    fireEvent.change(body, { target: { value: "Explain {{topic}} for {{audience}}." } });
    const topic = screen.getByLabelText(/topic/);
    const audience = screen.getByLabelText(/audience/);
    expect(topic).toHaveAttribute("aria-invalid", "true");
    expect(audience).toHaveAttribute("aria-invalid", "true");

    await user.click(screen.getByRole("button", { name: "Save prompt" }));
    expect(bridge.savePrompt).not.toHaveBeenCalled();
    expect(await screen.findByText(/Fill in the required variables: topic, audience/)).toBeInTheDocument();

    await user.type(topic, "recursion");
    await user.type(audience, "a new developer");
    await user.type(body, " Keep it practical.");
    expect(topic).toHaveValue("recursion");
    expect(audience).toHaveValue("a new developer");

    await user.click(screen.getByRole("button", { name: "Save prompt" }));
    await waitFor(() => expect(bridge.savePrompt).toHaveBeenCalledTimes(1));
  });

  it("supports workspace creation, switching, rename, and confirmed deletion", async () => {
    const initial = createState([], [workspace("workspace-1", "Personal workspace"), workspace("workspace-2", "Team space")]);
    const { bridge } = createBridge(initial);
    window.forgeboard = bridge;
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("Reusable instructions, close at hand.");

    await user.click(screen.getByRole("button", { name: "Workspace actions" }));
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    await user.type(screen.getByLabelText("Workspace name"), "Research desk");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() => expect(bridge.createWorkspace).toHaveBeenCalledWith("Research desk"));

    await user.click(screen.getByRole("button", { name: "Workspace actions" }));
    await user.click(screen.getAllByRole("button", { name: "Team space" })[1]);
    await waitFor(() => expect(bridge.setActiveWorkspace).toHaveBeenCalledWith("workspace-2"));

    await user.click(screen.getByRole("button", { name: "Workspace actions" }));
    await user.click(screen.getByRole("button", { name: "Rename workspace" }));
    const nameInput = screen.getByLabelText("Workspace name");
    await user.clear(nameInput);
    await user.type(nameInput, "Team renamed");
    await user.click(screen.getByRole("button", { name: "Save workspace" }));
    await waitFor(() => expect(bridge.renameWorkspace).toHaveBeenCalledWith("workspace-2", "Team renamed"));

    await user.click(screen.getByRole("button", { name: "Workspace actions" }));
    await user.click(screen.getByRole("button", { name: "Delete workspace" }));
    expect(screen.getByRole("dialog", { name: "Delete workspace?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete workspace" }));
    await waitFor(() => expect(bridge.deleteWorkspace).toHaveBeenCalledWith("workspace-2"));
  });

  it("binds search and new-prompt shortcuts outside text fields", async () => {
    const { bridge } = createBridge(createState());
    window.forgeboard = bridge;
    render(<App />);
    await screen.findByText("Reusable instructions, close at hand.");

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByRole("searchbox", { name: "Search prompts" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "n", ctrlKey: true });
    expect(await screen.findByText("Shape a reusable instruction.")).toBeInTheDocument();

    const title = screen.getByLabelText("Prompt title");
    fireEvent.keyDown(title, { key: "n", ctrlKey: true });
    expect(screen.getByLabelText("Prompt title")).toHaveValue("");
  });
});
