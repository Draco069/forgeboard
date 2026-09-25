import { describe, expect, it } from "vitest";
import { AppErrorException } from "../src/shared/errors";
import {
  parsePrompt,
  parseRequestRecord,
  timestampSchema,
} from "../src/shared/validation";
import type { Prompt, RequestRecord } from "../src/shared/types";

const canonicalTimestamp = "2026-09-25T10:00:00.000Z";

const prompt: Prompt = {
  id: "prompt-1",
  workspaceId: "workspace-1",
  title: "Review changes",
  description: "",
  body: "Review the changes.",
  tags: [],
  favorite: false,
  createdAt: canonicalTimestamp,
  updatedAt: canonicalTimestamp,
};

const request: RequestRecord = {
  id: "request-1",
  workspaceId: "workspace-1",
  connectionId: "connection-1",
  provider: "ollama",
  model: "llama3.2",
  renderedPrompt: "Review the changes.",
  response: "Looks good.",
  status: "success",
  createdAt: canonicalTimestamp,
};

const invalidTimestamps = [
  "2026-09-25",
  "2026-09-25T10:00:00Z",
  "2026-09-25T10:00:00.000+00:00",
  "2026-02-30T10:00:00.000Z",
  "not-a-timestamp",
];

describe("shared record validation", () => {
  it("accepts canonical ISO date-time strings", () => {
    expect(timestampSchema.safeParse(canonicalTimestamp).success).toBe(true);
    expect(parsePrompt(prompt).createdAt).toBe(canonicalTimestamp);
    expect(parseRequestRecord(request).createdAt).toBe(canonicalTimestamp);
  });

  it.each(invalidTimestamps)("rejects noncanonical timestamp %s", (timestamp) => {
    expect(timestampSchema.safeParse(timestamp).success).toBe(false);
    expect(() => parsePrompt({ ...prompt, createdAt: timestamp })).toThrowError(
      AppErrorException,
    );
    expect(() => parseRequestRecord({ ...request, createdAt: timestamp })).toThrowError(
      AppErrorException,
    );
  });

  it("rejects request providers outside the shared provider kinds", () => {
    expect(() =>
      parseRequestRecord({ ...request, provider: "unknown" }),
    ).toThrowError(AppErrorException);
  });
});
