import { describe, expect, it } from "vitest";
import { AppErrorException } from "../src/shared/errors";
import {
  parsePromptMarkdown,
  parseSnapshot,
  serializePromptMarkdown,
  serializeSnapshot,
} from "../src/shared/serialization";
import type { Prompt, StoreDocument } from "../src/shared/types";
import { parseStoreDocument } from "../src/shared/validation";

const prompt: Prompt = {
  id: "prompt-1",
  workspaceId: "workspace-1",
  title: "Review a pull request",
  description: "Find correctness and security issues",
  body: "Review {{language}} changes.\n\nReturn concise findings.",
  tags: ["code-review", "security"],
  favorite: true,
  createdAt: "2026-09-25T10:00:00.000Z",
  updatedAt: "2026-09-25T10:05:00.000Z",
};

const document: StoreDocument = {
  schemaVersion: 1,
  workspaces: [
    {
      id: "workspace-1",
      name: "Personal workspace",
      createdAt: "2026-09-25T10:00:00.000Z",
      updatedAt: "2026-09-25T10:00:00.000Z",
    },
  ],
  prompts: [prompt],
  connections: [
    {
      id: "connection-1",
      name: "Local Ollama",
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "llama3.2",
      hasCredential: false,
      createdAt: "2026-09-25T10:00:00.000Z",
      updatedAt: "2026-09-25T10:00:00.000Z",
    },
  ],
  requests: [
    {
      id: "request-1",
      workspaceId: "workspace-1",
      promptId: prompt.id,
      connectionId: "connection-1",
      provider: "ollama",
      model: "llama3.2",
      renderedPrompt: "Review TypeScript changes.",
      response: "Looks good.",
      status: "success",
      durationMs: 42,
      createdAt: "2026-09-25T10:06:00.000Z",
    },
  ],
  settings: { theme: "system" },
  activeWorkspaceId: "workspace-1",
};

describe("prompt Markdown serialization", () => {
  it("includes the title, tags, description, and body", () => {
    const markdown = serializePromptMarkdown(prompt);

    expect(markdown).toContain("# Review a pull request");
    expect(markdown).toContain("Find correctness and security issues");
    expect(markdown).toContain("code-review");
    expect(markdown).toContain("security");
    expect(markdown).toContain("Return concise findings.");
  });

  it("round-trips the prompt-owned fields", () => {
    expect(parsePromptMarkdown(serializePromptMarkdown(prompt))).toEqual({
      title: prompt.title,
      description: prompt.description,
      body: prompt.body,
      tags: prompt.tags,
      favorite: prompt.favorite,
    });
  });

  it("parses common frontmatter lists and preserves body separator lines", () => {
    const markdown = [
      "---",
      "title: Imported prompt",
      "description: Imported description",
      "tags: [alpha, beta]",
      "favorite: false",
      "---",
      "",
      "# Imported prompt",
      "",
      "Imported description",
      "",
      "Tags: alpha, beta",
      "",
      "---",
      "",
      "first line",
      "---",
      "last line",
    ].join("\n");

    expect(parsePromptMarkdown(markdown)).toEqual({
      title: "Imported prompt",
      description: "Imported description",
      body: "first line\n---\nlast line",
      tags: ["alpha", "beta"],
      favorite: false,
    });
  });

  it("rejects malformed frontmatter with a validation app error", () => {
    expect.assertions(2);

    try {
      parsePromptMarkdown("# Missing frontmatter\n\n---\nbody");
    } catch (error) {
      expect(error).toBeInstanceOf(AppErrorException);
      expect((error as AppErrorException).code).toBe("VALIDATION");
    }
  });
});

describe("snapshot serialization and validation", () => {
  it("round-trips IDs, timestamps, and record data through JSON", () => {
    const parsed = parseSnapshot(serializeSnapshot(document));

    expect(parsed).toEqual(document);
  });

  it("rejects unsupported schema versions with a validation app error", () => {
    expect.assertions(2);

    try {
      parseStoreDocument({ ...document, schemaVersion: 2 });
    } catch (error) {
      expect(error).toBeInstanceOf(AppErrorException);
      expect((error as AppErrorException).code).toBe("VALIDATION");
    }
  });

  it("does not serialize transient credential fields", () => {
    const contents = serializeSnapshot({
      ...document,
      connections: [
        {
          ...document.connections[0],
          credential: "sk-should-not-be-exported",
        },
      ],
    } as unknown as StoreDocument);

    expect(contents).not.toContain("sk-should-not-be-exported");
    expect(contents).not.toContain("credential");
  });

  it("rejects credentials embedded in provider URLs", () => {
    expect(() =>
      parseStoreDocument({
        ...document,
        connections: [
          {
            ...document.connections[0],
            baseUrl: "https://user:password@example.com/v1",
          },
        ],
      }),
    ).toThrowError();
  });
});
