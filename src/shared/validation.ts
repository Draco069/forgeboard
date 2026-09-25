import { z } from "zod";
import { createValidationError, redactSecrets } from "./errors";
import type {
  Connection,
  Prompt,
  PromptDraft,
  RequestRecord,
  Settings,
  StoreDocument,
  Workspace,
} from "./types";

export const MAX_PROMPT_TITLE_LENGTH = 200;
export const MAX_PROMPT_DESCRIPTION_LENGTH = 5_000;
export const MAX_PROMPT_BODY_LENGTH = 100_000;
export const MAX_PROMPT_LENGTH = MAX_PROMPT_BODY_LENGTH;
export const MAX_TAG_LENGTH = 64;
export const MAX_TAGS_PER_PROMPT = 50;
export const MAX_RESPONSE_LENGTH = 1_000_000;
export const CURRENT_STORE_SCHEMA_VERSION = 1 as const;

const nonEmptyText = z.string().refine((value) => value.trim().length > 0, {
  message: "Value must not be blank.",
});
const idSchema = nonEmptyText.max(200);
const timestampSchema = nonEmptyText.max(100);
const titleSchema = nonEmptyText.max(MAX_PROMPT_TITLE_LENGTH);
const descriptionSchema = z.string().max(MAX_PROMPT_DESCRIPTION_LENGTH);
const tagSchema = nonEmptyText.max(MAX_TAG_LENGTH);
const tagsSchema = z.array(tagSchema).max(MAX_TAGS_PER_PROMPT);

export const providerSchema = z.enum(["ollama", "openai-compatible"]);
export const requestStatusSchema = z.enum(["success", "error", "cancelled"]);
export const themeSchema = z.enum(["system", "light", "dark"]);

export const httpUrlSchema = z.string().min(1).superRefine((value, context) => {
  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      context.addIssue({
        code: "custom",
        message: "Provider URLs must use HTTP or HTTPS.",
      });
    }

    if (url.username || url.password) {
      context.addIssue({
        code: "custom",
        message: "Provider URLs must not contain embedded credentials.",
      });
    }
  } catch {
    context.addIssue({
      code: "custom",
      message: "Provider URL must be a valid absolute URL.",
    });
  }
});

export const workspaceSchema: z.ZodType<Workspace> = z.object({
  id: idSchema,
  name: nonEmptyText.max(200),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const promptDraftSchema: z.ZodType<PromptDraft> = z.object({
  title: titleSchema,
  description: descriptionSchema,
  body: z.string().max(MAX_PROMPT_BODY_LENGTH),
  tags: tagsSchema,
  favorite: z.boolean(),
});

export const promptSchema: z.ZodType<Prompt> = z.object({
  id: idSchema,
  workspaceId: idSchema,
  title: titleSchema,
  description: descriptionSchema,
  body: z.string().max(MAX_PROMPT_BODY_LENGTH),
  tags: tagsSchema,
  favorite: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const connectionSchema: z.ZodType<Connection> = z.object({
  id: idSchema,
  name: nonEmptyText.max(200),
  provider: providerSchema,
  baseUrl: httpUrlSchema,
  model: nonEmptyText.max(200),
  hasCredential: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const requestRecordSchema: z.ZodType<RequestRecord> = z.object({
  id: idSchema,
  workspaceId: idSchema,
  promptId: idSchema.optional(),
  connectionId: idSchema,
  provider: providerSchema,
  model: nonEmptyText.max(200),
  renderedPrompt: z.string().max(MAX_PROMPT_BODY_LENGTH),
  response: z.string().max(MAX_RESPONSE_LENGTH),
  status: requestStatusSchema,
  errorMessage: z.string().max(4_000).optional(),
  durationMs: z.number().int().nonnegative().max(86_400_000).optional(),
  createdAt: timestampSchema,
  retained: z.boolean().optional(),
});

export const settingsSchema: z.ZodType<Settings> = z.object({
  theme: themeSchema,
  defaultConnectionId: idSchema.optional(),
});

export const storeDocumentSchema: z.ZodType<StoreDocument> = z
  .object({
    schemaVersion: z.literal(CURRENT_STORE_SCHEMA_VERSION),
    workspaces: z.array(workspaceSchema),
    prompts: z.array(promptSchema),
    connections: z.array(connectionSchema),
    requests: z.array(requestRecordSchema),
    settings: settingsSchema,
    activeWorkspaceId: idSchema,
  })
  .superRefine((document, context) => {
    const workspaceIds = new Set(document.workspaces.map((workspace) => workspace.id));
    const connectionIds = new Set(document.connections.map((connection) => connection.id));
    if (!workspaceIds.has(document.activeWorkspaceId)) {
      context.addIssue({
        code: "custom",
        path: ["activeWorkspaceId"],
        message: "The active workspace must exist in the document.",
      });
    }

    for (const [index, workspace] of document.workspaces.entries()) {
      if (document.workspaces.findIndex((candidate) => candidate.id === workspace.id) !== index) {
        context.addIssue({
          code: "custom",
          path: ["workspaces", index, "id"],
          message: "Workspace IDs must be unique.",
        });
      }
    }

    for (const [index, prompt] of document.prompts.entries()) {
      if (!workspaceIds.has(prompt.workspaceId)) {
        context.addIssue({
          code: "custom",
          path: ["prompts", index, "workspaceId"],
          message: "The prompt workspace must exist in the document.",
        });
      }
      if (document.prompts.findIndex((candidate) => candidate.id === prompt.id) !== index) {
        context.addIssue({
          code: "custom",
          path: ["prompts", index, "id"],
          message: "Prompt IDs must be unique.",
        });
      }
    }

    for (const [index, connection] of document.connections.entries()) {
      if (
        document.connections.findIndex((candidate) => candidate.id === connection.id) !==
        index
      ) {
        context.addIssue({
          code: "custom",
          path: ["connections", index, "id"],
          message: "Connection IDs must be unique.",
        });
      }
    }

    for (const [index, request] of document.requests.entries()) {
      if (!workspaceIds.has(request.workspaceId)) {
        context.addIssue({
          code: "custom",
          path: ["requests", index, "workspaceId"],
          message: "The request workspace must exist in the document.",
        });
      }
      if (document.requests.findIndex((candidate) => candidate.id === request.id) !== index) {
        context.addIssue({
          code: "custom",
          path: ["requests", index, "id"],
          message: "Request IDs must be unique.",
        });
      }
    }

    if (
      document.settings.defaultConnectionId &&
      !connectionIds.has(document.settings.defaultConnectionId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["settings", "defaultConnectionId"],
        message: "The default connection must exist in the document.",
      });
    }
  });

export const WorkspaceSchema = workspaceSchema;
export const PromptSchema = promptSchema;
export const ConnectionSchema = connectionSchema;
export const RequestRecordSchema = requestRecordSchema;
export const SettingsSchema = settingsSchema;
export const StoreDocumentSchema = storeDocumentSchema;

function formatValidationIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "value";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function parseJsonDocument(value: string | unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw createValidationError("The store document is not valid JSON.");
  }
}

function readSchemaVersion(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const version = (value as { schemaVersion?: unknown }).schemaVersion;
  return typeof version === "number" && Number.isInteger(version) ? version : undefined;
}

export function parseStoreDocument(value: unknown): StoreDocument {
  const candidate = parseJsonDocument(value);
  const schemaVersion = readSchemaVersion(candidate);

  if (schemaVersion !== undefined && schemaVersion !== CURRENT_STORE_SCHEMA_VERSION) {
    throw createValidationError(`Unsupported store schema version: ${schemaVersion}.`);
  }

  const result = storeDocumentSchema.safeParse(candidate);
  if (!result.success) {
    throw createValidationError(redactSecrets(formatValidationIssues(result.error)));
  }

  return result.data;
}

export function parsePrompt(value: unknown): Prompt {
  const result = promptSchema.safeParse(value);
  if (!result.success) {
    throw createValidationError(redactSecrets(formatValidationIssues(result.error)));
  }

  return result.data;
}

export function parsePromptDraft(value: unknown): PromptDraft {
  const result = promptDraftSchema.safeParse(value);
  if (!result.success) {
    throw createValidationError(redactSecrets(formatValidationIssues(result.error)));
  }

  return result.data;
}

export function parseWorkspace(value: unknown): Workspace {
  const result = workspaceSchema.safeParse(value);
  if (!result.success) {
    throw createValidationError(redactSecrets(formatValidationIssues(result.error)));
  }

  return result.data;
}

export function parseConnection(value: unknown): Connection {
  const result = connectionSchema.safeParse(value);
  if (!result.success) {
    throw createValidationError(redactSecrets(formatValidationIssues(result.error)));
  }

  return result.data;
}

export function parseRequestRecord(value: unknown): RequestRecord {
  const result = requestRecordSchema.safeParse(value);
  if (!result.success) {
    throw createValidationError(redactSecrets(formatValidationIssues(result.error)));
  }

  return result.data;
}

export function parseSettings(value: unknown): Settings {
  const result = settingsSchema.safeParse(value);
  if (!result.success) {
    throw createValidationError(redactSecrets(formatValidationIssues(result.error)));
  }

  return result.data;
}

export type StoreMigration = (value: unknown) => unknown;

/**
 * Applies explicit, ordered migrations before validating the current document.
 * A future schema increment only needs a migration entry keyed by its source
 * version; unknown versions are rejected instead of being coerced.
 */
export function migrateStoreDocument(
  value: unknown,
  migrations: Readonly<Record<number, StoreMigration>> = {},
): StoreDocument {
  let candidate = parseJsonDocument(value);
  let version = readSchemaVersion(candidate);

  if (version === undefined) {
    return parseStoreDocument(candidate);
  }
  if (version < 0 || version > CURRENT_STORE_SCHEMA_VERSION) {
    throw createValidationError(`Unsupported store schema version: ${version}.`);
  }

  while (version < CURRENT_STORE_SCHEMA_VERSION) {
    const migration = migrations[version];
    if (!migration) {
      throw createValidationError(`No migration is available for store schema version ${version}.`);
    }
    candidate = migration(candidate);
    const nextVersion = readSchemaVersion(candidate);
    if (nextVersion === undefined || nextVersion <= version) {
      throw createValidationError("The store migration did not advance the schema version.");
    }
    version = nextVersion;
  }

  return parseStoreDocument(candidate);
}
