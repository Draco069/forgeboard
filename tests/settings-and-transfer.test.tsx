import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";
import { ImportExportControls } from "../src/renderer/components/ImportExportControls";
import { SettingsView } from "../src/renderer/components/SettingsView";
import { createRendererState } from "../src/renderer/state";
import { createAppError, AppErrorException } from "../src/shared/errors";
import {
  detectImportFileKind,
  parsePromptMarkdown,
  promptMarkdownFilename,
  sanitizeDownloadFilename,
  serializePromptMarkdown,
} from "../src/shared/serialization";
import type {
  AppState,
  Connection,
  ForgeboardApi,
  ImportReport,
  Prompt,
  Settings,
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
    description: "A calm onboarding answer",
    body: "Explain {{topic}} for a new developer.",
    tags: ["onboarding"],
    favorite: false,
    createdAt: now,
    updatedAt: now,
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

function createBridge(initialState: AppState) {
  let currentState = initialState;
  const settings = (patch: Partial<Settings>): Settings => {
    currentState = {
      ...currentState,
      document: { ...currentState.document, settings: { ...currentState.document.settings, ...patch } },
    };
    return currentState.document.settings;
  };

  const bridge: ForgeboardApi = {
    ping: vi.fn().mockResolvedValue({ app: "Forgeboard", version: "0.1.0" }),
    getState: vi.fn(async () => currentState),
    createWorkspace: vi.fn(),
    renameWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    setActiveWorkspace: vi.fn(),
    savePrompt: vi.fn(),
    deletePrompt: vi.fn(),
    saveConnection: vi.fn(),
    deleteConnection: vi.fn(async (idOrInput) => {
      const id = typeof idOrInput === "string" ? idOrInput : idOrInput.id;
      const nextSettings = { ...currentState.document.settings };
      if (nextSettings.defaultConnectionId === id) {
        delete nextSettings.defaultConnectionId;
      }
      currentState = {
        ...currentState,
        document: {
          ...currentState.document,
          connections: currentState.document.connections.filter((item) => item.id !== id),
          settings: nextSettings,
        },
      };
    }),
    updateSettings: vi.fn(async (input) => settings(input)),
    runRequest: vi.fn(),
    cancelRequest: vi.fn(),
    exportData: vi.fn(),
    importData: vi.fn(),
    onRunEvent: vi.fn(() => () => undefined),
  } as ForgeboardApi;

  return { bridge, getState: () => currentState };
}

interface DownloadRecord {
  name: string;
  href: string;
  blob?: Blob;
}

function captureDownloads(): DownloadRecord[] {
  const records: DownloadRecord[] = [];
  let lastBlob: Blob | undefined;

  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn((blob: Blob) => {
      lastBlob = blob;
      return "blob:forgeboard-test";
    }),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function capture(
    this: HTMLAnchorElement,
  ) {
    records.push({ name: this.download, href: this.href, blob: lastBlob });
    lastBlob = undefined;
  });

  return records;
}

function renderSettings(overrides: Partial<ComponentProps<typeof SettingsView>> = {}) {
  const appState = state(
    { connections: [connection(), connection({ id: "connection-2", name: "Team gateway", provider: "openai-compatible", model: "gpt-4o-mini", hasCredential: true })] },
    [prompt()],
  );
  const handlers = {
    onSettingsUpdate: vi.fn(),
    onThemeChange: vi.fn(),
    onCreateConnection: vi.fn(),
    onEditConnection: vi.fn(),
    onDeleteConnection: vi.fn(),
    onExportWorkspace: vi.fn(() => "forgeboard-export.json"),
    onExportPrompt: vi.fn(() => "explain-a-concept.md"),
    onImportJson: vi.fn(),
    onImportMarkdown: vi.fn(),
    ...overrides,
  };
  const stateValue = createRendererState(appState);
  render(
    <SettingsView
      onCreateConnection={handlers.onCreateConnection}
      onDeleteConnection={handlers.onDeleteConnection}
      onEditConnection={handlers.onEditConnection}
      onExportPrompt={handlers.onExportPrompt}
      onExportWorkspace={handlers.onExportWorkspace}
      onImportJson={handlers.onImportJson}
      onImportMarkdown={handlers.onImportMarkdown}
      onSettingsUpdate={handlers.onSettingsUpdate}
      onThemeChange={handlers.onThemeChange}
      state={stateValue}
    />,
  );
  return handlers;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("settings preferences", () => {
  it("persists the theme and the default connection through the bridge", async () => {
    const user = userEvent.setup();
    const handlers = renderSettings();

    expect(screen.getByRole("button", { name: "Theme: System" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The bridge only accepts a known connection id, so the empty choice is a
    // placeholder that must not be selectable.
    expect(screen.getByRole("option", { name: "No default connection" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Theme: Dark" }));

    await waitFor(() =>
      expect(handlers.onSettingsUpdate).toHaveBeenCalledWith({ theme: "dark" }),
    );
    expect(handlers.onThemeChange).not.toHaveBeenCalled();
    expect(await screen.findByText("Color theme set to dark.")).toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText("Default model connection"),
      "connection-2",
    );
    await waitFor(() =>
      expect(handlers.onSettingsUpdate).toHaveBeenCalledWith({
        defaultConnectionId: "connection-2",
      }),
    );
    expect(await screen.findByText("Default model connection updated.")).toBeInTheDocument();
  });

  it("reports a safe failure when the bridge rejects a settings change", async () => {
    const user = userEvent.setup();
    renderSettings({
      onSettingsUpdate: vi.fn(async () => {
        throw new AppErrorException(
          createAppError("STORAGE", "The workspace file could not be replaced.", true),
        );
      }),
    });

    await user.click(screen.getByRole("button", { name: "Theme: Light" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The local data could not be accessed.");
    expect(alert).toHaveTextContent("The workspace file could not be replaced.");
    expect(screen.queryByText("Color theme set to light.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Theme: System" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("routes the topbar theme choice through the bridge and refreshes state", async () => {
    const { bridge } = createBridge(state({ connections: [connection()] }, [prompt()]));
    window.forgeboard = bridge;
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("Explain a concept");
    await user.click(screen.getByRole("button", { name: "Dark theme" }));

    await waitFor(() => expect(bridge.updateSettings).toHaveBeenCalledWith({ theme: "dark" }));
    await waitFor(() => expect(bridge.getState).toHaveBeenCalledTimes(2));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("refreshes bridge state after a settings change from the settings view", async () => {
    const { bridge } = createBridge(state({ connections: [connection()] }, [prompt()]));
    window.forgeboard = bridge;
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("Explain a concept");
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await screen.findByRole("heading", { level: 1, name: "Calm, local, and in your control." });

    await user.selectOptions(
      screen.getByLabelText("Default model connection"),
      "connection-1",
    );

    await waitFor(() =>
      expect(bridge.updateSettings).toHaveBeenCalledWith({ defaultConnectionId: "connection-1" }),
    );
    expect(bridge.getState).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("Default model connection updated.")).toBeInTheDocument();
  });
});

describe("workspace transfers", () => {
  it("exports the full JSON workspace through a safe renderer download", async () => {
    const snapshot = JSON.stringify(state({ connections: [connection()] }, [prompt()]).document);
    const downloads = captureDownloads();
    const { bridge } = createBridge(state({ connections: [connection()] }, [prompt()]));
    (bridge.exportData as ReturnType<typeof vi.fn>).mockResolvedValue({
      filename: "forgeboard-export.json",
      contents: snapshot,
    });
    window.forgeboard = bridge;
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("Explain a concept");
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Export workspace JSON" }));

    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(bridge.exportData).toHaveBeenCalledTimes(1);
    expect(downloads[0].name).toBe("forgeboard-export.json");
    expect(downloads[0].href).toMatch(/^blob:/);
    expect(downloads[0].href).not.toContain("\\");
    expect(await downloads[0].blob?.text()).toBe(snapshot);
    expect(
      await screen.findByText("Exported the workspace snapshot to forgeboard-export.json."),
    ).toBeInTheDocument();
  });

  it("exports the selected prompt as Markdown with the shared serializer", async () => {
    const saved = prompt();
    const downloads = captureDownloads();
    const { bridge } = createBridge(state({ connections: [connection()] }, [saved]));
    window.forgeboard = bridge;
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("Explain a concept");
    await user.click(screen.getByRole("button", { name: /^Explain a concept/ }));
    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("button", { name: "Export selected prompt" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Export selected prompt" }));

    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].name).toBe(promptMarkdownFilename(saved));
    expect(await downloads[0].blob?.text()).toBe(serializePromptMarkdown(saved));
    const markdown = (await downloads[0].blob?.text()) ?? "";
    expect(markdown.startsWith("---\n")).toBe(true);
    expect(markdown).toContain('title: "Explain a concept"');
    expect(markdown).toContain("Explain {{topic}} for a new developer.");
  });

  it("keeps the Markdown export unavailable until a prompt is selected", async () => {
    const { bridge } = createBridge(state());
    window.forgeboard = bridge;
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("Reusable instructions, close at hand.");
    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("button", { name: "Export selected prompt" })).toBeDisabled();
  });

  it("reports imported counts and safe warnings after a JSON import", async () => {
    const user = userEvent.setup();
    const report: ImportReport = {
      counts: { workspaces: 2, prompts: 5, connections: 1, requests: 3 },
      warnings: ["Some connection credentials must be entered again after import."],
    };
    const onImportJson = vi.fn(async () => report);

    render(
      <ImportExportControls
        onExportPrompt={null}
        onExportWorkspace={vi.fn(() => "forgeboard-export.json")}
        onImportJson={onImportJson}
        onImportMarkdown={vi.fn(async () => "Imported")}
      />,
    );

    const file = new File(['{"schemaVersion":1}'], "forgeboard-export.json", {
      type: "application/json",
    });
    await user.upload(screen.getByLabelText("Import file"), file);

    await waitFor(() => expect(onImportJson).toHaveBeenCalledTimes(1));
    expect(onImportJson).toHaveBeenCalledWith('{"schemaVersion":1}');
    expect(
      await screen.findByText("Imported 2 workspaces, 5 prompts, 1 connection, 3 runs."),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("import-report")).getByText(
        "Some connection credentials must be entered again after import.",
      ),
    ).toBeInTheDocument();
  });

  it("imports Markdown into the active workspace through the shared parser", async () => {
    const user = userEvent.setup();
    const incoming = prompt({ id: "imported", title: "Release checklist" });
    const { bridge } = createBridge(state({ connections: [connection()] }, [prompt()]));
    bridge.savePrompt = vi.fn(async (input) =>
      prompt({
        id: "imported-1",
        title: input.title,
        description: input.description,
        body: input.body,
        tags: input.tags,
        favorite: input.favorite,
      }),
    );
    window.forgeboard = bridge;

    render(<App />);
    await screen.findByText("Explain a concept");
    await user.click(screen.getByRole("button", { name: "Settings" }));

    const markdown = serializePromptMarkdown(incoming);
    await user.upload(
      screen.getByLabelText("Import file"),
      new File([markdown], "release-checklist.md", { type: "text/markdown" }),
    );

    await waitFor(() => expect(bridge.savePrompt).toHaveBeenCalledTimes(1));
    expect(bridge.savePrompt).toHaveBeenCalledWith({
      title: "Release checklist",
      description: incoming.description,
      body: incoming.body,
      tags: incoming.tags,
      favorite: incoming.favorite,
      workspaceId: workspace.id,
    });
    expect(
      await screen.findByText("Imported the prompt “Release checklist” into this workspace."),
    ).toBeInTheDocument();
    expect(bridge.importData).not.toHaveBeenCalled();
  });

  it("rejects a malformed Markdown file without touching the workspace", async () => {
    const user = userEvent.setup();
    const { bridge } = createBridge(state({ connections: [connection()] }, [prompt()]));
    window.forgeboard = bridge;

    render(<App />);
    await screen.findByText("Explain a concept");
    await user.click(screen.getByRole("button", { name: "Settings" }));

    await user.upload(
      screen.getByLabelText("Import file"),
      new File(["# Notes\n\nnot a forgeboard prompt"], "notes.md", { type: "text/markdown" }),
    );

    expect(
      await screen.findByText(/Prompt Markdown must start with frontmatter/),
    ).toBeInTheDocument();
    expect(bridge.savePrompt).not.toHaveBeenCalled();
    expect(bridge.importData).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^Prompts/ }));
    expect(await screen.findByText("Explain a concept")).toBeInTheDocument();
  });

  it("keeps the current workspace when a JSON import is rejected", async () => {
    const user = userEvent.setup();
    const { bridge } = createBridge(state({ connections: [connection()] }, [prompt()]));
    (bridge.importData as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AppErrorException(
        createAppError("IMPORT", "Unsupported store schema version: 7.", false),
      ),
    );
    window.forgeboard = bridge;

    render(<App />);
    await screen.findByText("Explain a concept");
    await user.click(screen.getByRole("button", { name: "Settings" }));

    await user.upload(
      screen.getByLabelText("Import file"),
      new File(['{"schemaVersion":7}'], "future-export.json", { type: "application/json" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The imported data could not be accepted.");
    expect(alert).toHaveTextContent("Unsupported store schema version: 7.");
    expect(alert.textContent).not.toContain("sk-");
    expect(bridge.getState).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /^Prompts/ }));
    expect(await screen.findByText("Explain a concept")).toBeInTheDocument();
  });

  it("rejects an unsupported file type before reading it", async () => {
    // `applyAccept` is disabled so the component, not the picker, rejects the file.
    const user = userEvent.setup({ applyAccept: false });
    const onImportJson = vi.fn();
    const onImportMarkdown = vi.fn();

    render(
      <ImportExportControls
        onExportPrompt={null}
        onExportWorkspace={vi.fn(() => "forgeboard-export.json")}
        onImportJson={onImportJson}
        onImportMarkdown={onImportMarkdown}
      />,
    );

    await user.upload(
      screen.getByLabelText("Import file"),
      new File(["plain text"], "notes.txt", { type: "text/plain" }),
    );

    expect(
      await screen.findByText(
        "Choose a Forgeboard .json workspace export or a .md prompt file.",
      ),
    ).toBeInTheDocument();
    expect(onImportJson).not.toHaveBeenCalled();
    expect(onImportMarkdown).not.toHaveBeenCalled();
  });
});

describe("connection cleanup", () => {
  it("confirms a destructive delete, restores focus, and closes on Escape", async () => {
    const user = userEvent.setup();
    const handlers = renderSettings();

    const deleteButton = screen.getByRole("button", { name: "Delete connection Local Ollama" });
    await user.click(deleteButton);

    const dialog = await screen.findByRole("dialog", { name: "Delete this connection?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent("Local Ollama");
    expect(dialog).toHaveTextContent("erases its stored credential");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete connection" })).toHaveFocus(),
    );

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(handlers.onDeleteConnection).not.toHaveBeenCalled();
    await waitFor(() => expect(deleteButton).toHaveFocus());
  });

  it("deletes the connection after an explicit confirmation", async () => {
    const user = userEvent.setup();
    const handlers = renderSettings();

    await user.click(screen.getByRole("button", { name: "Delete connection Team gateway" }));
    await user.click(await screen.findByRole("button", { name: "Delete connection" }));

    await waitFor(() => expect(handlers.onDeleteConnection).toHaveBeenCalledWith("connection-2"));
    expect(await screen.findByText("Deleted the Team gateway connection.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the confirmation open and reports a safe failure", async () => {
    const user = userEvent.setup();
    const handlers = renderSettings({
      onDeleteConnection: vi.fn(async () => {
        throw new AppErrorException(
          createAppError("STORAGE", "The workspace file could not be replaced.", true),
        );
      }),
    });

    await user.click(screen.getByRole("button", { name: "Delete connection Local Ollama" }));
    await user.click(await screen.findByRole("button", { name: "Delete connection" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The local data could not be accessed.");
    expect(alert).toHaveTextContent("The workspace file could not be replaced.");
    expect(handlers.onDeleteConnection).toHaveBeenCalledWith("connection-1");
    expect(screen.getByRole("dialog", { name: "Delete this connection?" })).toBeInTheDocument();
  });
});

describe("settings accessibility and privacy", () => {
  it("uses semantic headings and labels for every control", () => {
    renderSettings();

    expect(
      screen.getByRole("heading", { level: 1, name: "Calm, local, and in your control." }),
    ).toBeInTheDocument();
    for (const heading of [
      "Color theme",
      "Default connection",
      "Move your workspace in and out",
      "What leaves this device",
    ]) {
      expect(screen.getByRole("heading", { level: 2, name: heading })).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Import file")).toBeInTheDocument();
    expect(screen.getByLabelText("Default model connection")).toBeInTheDocument();

    for (const control of screen.getAllByRole("button")) {
      const name =
        (control.textContent ?? "").trim() || (control.getAttribute("aria-label") ?? "");
      expect(name.length, `control without an accessible name: ${control.outerHTML}`).toBeGreaterThan(
        0,
      );
    }
    expect(
      screen.getAllByRole("status").filter((region) => region.getAttribute("aria-live")).length,
    ).toBeGreaterThan(0);
  });

  it("never renders or exports a credential value", async () => {
    const secret = "sk-live-should-never-appear";
    // The renderer only ever sees a sanitized connection. The stray field
    // proves the surface ignores anything credential-shaped it is handed.
    const leaky = {
      ...connection({ id: "connection-3", name: "Secret gateway", hasCredential: true }),
      credential: secret,
    } as Connection;
    const appState = state({ connections: [leaky] }, [prompt()]);
    const downloads = captureDownloads();
    const { bridge } = createBridge(appState);
    // The main process never stores a credential in the document it exports.
    const exported = state({ connections: [connection({ hasCredential: false })] }, [prompt()])
      .document;
    (bridge.exportData as ReturnType<typeof vi.fn>).mockResolvedValue({
      filename: "forgeboard-export.json",
      contents: JSON.stringify(exported),
    });
    window.forgeboard = bridge;
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("Explain a concept");
    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByText("Credential saved securely")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(secret);
    expect(document.body.innerHTML).not.toContain(secret);

    await user.click(screen.getByRole("button", { name: "Export workspace JSON" }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(await downloads[0].blob?.text()).not.toContain(secret);
    expect(screen.getByText(/Credential values are never shown/)).toBeInTheDocument();
    expect(screen.getByText(/operating system's secure credential store/)).toBeInTheDocument();
  });
});

describe("transfer file helpers", () => {
  it("resolves the import format from a filename", () => {
    expect(detectImportFileKind("forgeboard-export.json")).toBe("json");
    expect(detectImportFileKind("notes.md")).toBe("markdown");
    expect(detectImportFileKind("notes.MARKDOWN")).toBe("markdown");
    expect(detectImportFileKind("photo.png")).toBeNull();
    expect(detectImportFileKind("   ")).toBeNull();
  });

  it("reduces a title or bridge filename to one safe download name", () => {
    expect(sanitizeDownloadFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeDownloadFilename("C:\\Users\\dev\\forgeboard-export.json")).toBe(
      "forgeboard-export.json",
    );
    expect(sanitizeDownloadFilename("   ")).toBe("forgeboard-export.json");
    expect(sanitizeDownloadFilename("...", "fallback.md")).toBe("fallback.md");
    expect(promptMarkdownFilename({ title: "Explain /review: a concept? " })).toBe(
      "Explain-review-a-concept.md",
    );
    expect(promptMarkdownFilename({ title: "***" })).toBe("forgeboard-prompt.md");
  });

  it("round-trips an exported prompt through the shared Markdown format", () => {
    const original = prompt({ body: "Review {{diff}} and list the {{severity}} issues." });
    const draft = parsePromptMarkdown(serializePromptMarkdown(original));
    expect(draft).toEqual({
      title: original.title,
      description: original.description,
      body: original.body,
      tags: original.tags,
      favorite: original.favorite,
    });
  });
});

describe("visual system contract", () => {
  const styles = readFileSync(
    resolve(process.cwd(), "src/renderer/styles.css"),
    "utf8",
  );

  function themeBlock(selector: string): string {
    const start = styles.indexOf(selector);
    expect(start, `missing ${selector}`).toBeGreaterThanOrEqual(0);
    const open = styles.indexOf("{", start);
    const close = styles.indexOf("}", open);
    return styles.slice(open, close);
  }

  function variable(block: string, name: string): string {
    const match = new RegExp(`${name}:\\s*(#[0-9a-f]{3,8})`, "i").exec(block);
    expect(match, `missing ${name}`).not.toBeNull();
    return match![1];
  }

  function contrast(foreground: string, background: string): number {
    const channel = (value: number): number => {
      const scaled = value / 255;
      return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (color: string): number => {
      const hex = color.replace("#", "");
      const full =
        hex.length === 3
          ? hex
              .split("")
              .map((digit) => digit + digit)
              .join("")
          : hex;
      const [red, green, blue] = [0, 2, 4].map((offset) =>
        channel(parseInt(full.slice(offset, offset + 2), 16)),
      );
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const lighter = Math.max(luminance(foreground), luminance(background));
    const darker = Math.min(luminance(foreground), luminance(background));
    return (lighter + 0.05) / (darker + 0.05);
  }

  it("keeps the primary, secondary, and danger buttons WCAG safe in both themes", () => {
    for (const selector of [":root", ':root[data-theme="dark"]']) {
      const block = themeBlock(selector);
      const pairs: Array<[string, string, string]> = [
        ["primary", "--button-primary-fg", "--button-primary-bg"],
        ["danger", "--button-danger-fg", "--button-danger-bg"],
        ["secondary", "--text", "--surface-raised"],
      ];
      for (const [name, foreground, background] of pairs) {
        const ratio = contrast(variable(block, foreground), variable(block, background));
        expect(ratio, `${selector} ${name} contrast`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("declares narrow, medium, and wide layouts plus a reduced-motion fallback", () => {
    expect(styles).toContain("min-width: 320px");
    expect(styles).toContain("@media (max-width: 320px)");
    expect(styles).toContain("@media (max-width: 768px)");
    expect(styles).toContain("@media (min-width: 1280px)");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition-duration: 0\.01ms/);
  });

  it("keeps settings tracks fluid so narrow windows never scroll sideways", () => {
    const settingsRules = styles.slice(styles.indexOf("/* Settings, transfers"));
    // Media preludes are dropped first: a `min-width` there is a breakpoint.
    const declarations = settingsRules.replace(/@media[^{]*/g, "");
    expect(settingsRules).toMatch(/\.settings-grid\s*\{[^}]*minmax\(0, 1fr\)/);
    expect(declarations).not.toMatch(/min-width:\s*\d{3,}px/);
    expect(settingsRules).toMatch(/\.theme-option-grid\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/);
  });
});
