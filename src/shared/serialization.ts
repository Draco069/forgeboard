import { createValidationError } from "./errors";
import type { Prompt, PromptDraft, StoreDocument } from "./types";
import {
  parsePrompt,
  parsePromptDraft,
  parseStoreDocument,
  promptSchema,
} from "./validation";

export const MARKDOWN_FRONTMATTER_MARKER = "---";
export const MARKDOWN_BODY_SEPARATOR = "---";

const ESCAPED_BODY_SEPARATOR = "<!-- forgeboard:body-separator -->";
const ESCAPED_BODY_SEPARATOR_LITERAL =
  "<!-- forgeboard:escaped-body-separator -->";

function escapeBody(value: string): string {
  return value
    .split(ESCAPED_BODY_SEPARATOR)
    .join(ESCAPED_BODY_SEPARATOR_LITERAL)
    .split(/\r?\n/)
    .map((line) => (line === MARKDOWN_BODY_SEPARATOR ? ESCAPED_BODY_SEPARATOR : line))
    .join("\n");
}

function unescapeBody(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => {
      if (line === ESCAPED_BODY_SEPARATOR_LITERAL) {
        return ESCAPED_BODY_SEPARATOR;
      }
      if (line === ESCAPED_BODY_SEPARATOR) {
        return MARKDOWN_BODY_SEPARATOR;
      }
      return line;
    })
    .join("\n");
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();

  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed === "null") {
    return null;
  }
  if (
    (trimmed.startsWith('"') && !trimmed.endsWith('"')) ||
    (trimmed.startsWith("[") && !trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && !trimmed.endsWith("}")) ||
    (trimmed.startsWith("'") && !trimmed.endsWith("'"))
  ) {
    throw createValidationError("Prompt frontmatter contains malformed JSON.");
  }
  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      throw createValidationError("Prompt frontmatter contains malformed JSON.");
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }

  return trimmed;
}

function parseTagList(value: string): unknown[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw createValidationError("Prompt frontmatter tags must be a list.");
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    const contents = trimmed.slice(1, -1).trim();
    if (contents.length === 0) {
      return [];
    }
    return contents.split(",").map((tag) => parseScalar(tag));
  }

  throw createValidationError("Prompt frontmatter tags must be a list.");
}

function parseFrontmatter(lines: string[]): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  let listKey: string | undefined;

  for (const line of lines) {
    if (line.trim().length === 0 || line.trimStart().startsWith("#")) {
      continue;
    }

    const listItem = /^\s+-\s+(.*)$/.exec(line);
    if (listItem) {
      if (!listKey || !Array.isArray(fields[listKey])) {
        throw createValidationError("Prompt frontmatter contains an invalid list.");
      }
      (fields[listKey] as unknown[]).push(parseScalar(listItem[1]));
      continue;
    }

    const field = /^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/.exec(line);
    if (!field) {
      throw createValidationError("Prompt frontmatter is malformed.");
    }

    const key = field[1].toLowerCase();
    const rawValue = field[2]?.trim() ?? "";

    if (!["title", "description", "tags", "favorite"].includes(key)) {
      listKey = undefined;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      throw createValidationError("Prompt frontmatter contains duplicate fields.");
    }

    if (key === "tags" && rawValue.length === 0) {
      fields[key] = [];
      listKey = key;
      continue;
    }
    if (key === "tags") {
      fields[key] = rawValue.startsWith("[")
        ? parseTagList(rawValue)
        : rawValue
            .split(",")
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0);
      listKey = undefined;
      continue;
    }

    fields[key] = parseScalar(rawValue);
    listKey = undefined;
  }

  return fields;
}

function splitFrontmatter(markdown: string): {
  fields: Record<string, unknown>;
  content: string;
} {
  if (typeof markdown !== "string") {
    throw createValidationError("Prompt Markdown must be text.");
  }

  const normalized = markdown.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== MARKDOWN_FRONTMATTER_MARKER) {
    throw createValidationError("Prompt Markdown must start with frontmatter.");
  }

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === MARKDOWN_FRONTMATTER_MARKER,
  );
  if (closingIndex === -1) {
    throw createValidationError("Prompt Markdown frontmatter is not closed.");
  }

  return {
    fields: parseFrontmatter(lines.slice(1, closingIndex)),
    content: lines.slice(closingIndex + 1).join("\n"),
  };
}

function parseBody(content: string): string {
  const lines = content.split("\n");
  const separatorIndex = lines.findIndex(
    (line) => line.trim() === MARKDOWN_BODY_SEPARATOR,
  );
  if (separatorIndex === -1) {
    throw createValidationError("Prompt Markdown is missing the body separator.");
  }

  let body = lines.slice(separatorIndex + 1).join("\n");
  if (body.startsWith("\n")) {
    body = body.slice(1);
  }

  return unescapeBody(body);
}

function displayTags(tags: string[]): string {
  return tags.length === 0
    ? "None"
    : tags
        .map((tag) => tag.replace(/\r?\n/g, " "))
        .join(", ");
}

export function serializePromptMarkdown(prompt: Prompt): string {
  const validPrompt = parsePrompt(prompt);
  const safeTitle = validPrompt.title.replace(/\r?\n/g, " ");
  const safeDescription = escapeBody(validPrompt.description);
  const safeTags = escapeBody(displayTags(validPrompt.tags));

  return [
    MARKDOWN_FRONTMATTER_MARKER,
    `title: ${JSON.stringify(validPrompt.title)}`,
    `description: ${JSON.stringify(validPrompt.description)}`,
    `tags: ${JSON.stringify(validPrompt.tags)}`,
    `favorite: ${validPrompt.favorite}`,
    MARKDOWN_FRONTMATTER_MARKER,
    "",
    `# ${safeTitle}`,
    "",
    safeDescription,
    "",
    `Tags: ${safeTags}`,
    "",
    MARKDOWN_BODY_SEPARATOR,
    "",
    escapeBody(validPrompt.body),
  ].join("\n");
}

export function parsePromptMarkdown(markdown: string): PromptDraft {
  const { fields, content } = splitFrontmatter(markdown);
  const title = fields.title;
  const description = fields.description;
  const tags = fields.tags;
  const favorite = fields.favorite;

  if (typeof title !== "string") {
    throw createValidationError("Prompt frontmatter is missing a title.");
  }
  if (description !== undefined && typeof description !== "string") {
    throw createValidationError("Prompt frontmatter description must be text.");
  }
  if (tags !== undefined && !Array.isArray(tags)) {
    throw createValidationError("Prompt frontmatter tags must be a list.");
  }
  if (favorite !== undefined && typeof favorite !== "boolean") {
    throw createValidationError("Prompt frontmatter favorite must be true or false.");
  }

  return parsePromptDraft({
    title,
    description: description ?? "",
    body: parseBody(content),
    tags: tags ?? [],
    favorite: favorite ?? false,
  });
}

function parseJsonInput(value: string | unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw createValidationError("The JSON document is not valid JSON.");
  }
}

export function serializeSnapshot(document: StoreDocument): string {
  return JSON.stringify(parseStoreDocument(document), null, 2);
}

export function parseSnapshot(value: string | unknown): StoreDocument {
  return parseStoreDocument(parseJsonInput(value));
}

export function serializePromptJson(prompt: Prompt): string {
  const result = promptSchema.safeParse(prompt);
  if (!result.success) {
    throw createValidationError("The prompt is not valid for JSON export.");
  }

  return JSON.stringify(result.data, null, 2);
}

export function parsePromptJson(value: string | unknown): Prompt {
  return parsePrompt(parseJsonInput(value));
}

export const serializeStoreDocument = serializeSnapshot;
export const parseStoreDocumentJson = parseSnapshot;
export const deserializeStoreDocument = parseSnapshot;
export const serializeJson = serializeSnapshot;
export const parseJson = parseSnapshot;
