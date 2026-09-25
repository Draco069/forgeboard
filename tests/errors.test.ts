import { describe, expect, it } from "vitest";
import {
  AppErrorException,
  normalizeAppError,
  redactSecrets,
} from "../src/shared/errors";

describe("application errors", () => {
  it("redacts every non-empty secret, including repeated occurrences", () => {
    expect(
      redactSecrets(
        "token=secret; retry-token=other; empty=",
        ["secret", "", "retry-token"],
      ),
    ).toBe("token=[REDACTED]; [REDACTED]=other; empty=");
  });

  it("redacts common credential-shaped values without an explicit secret list", () => {
    expect(redactSecrets("api_key=abc123 token=xyz789")).toBe(
      "api_key=[REDACTED] token=[REDACTED]",
    );
  });

  it("normalizes a network error and redacts known credentials", () => {
    const result = normalizeAppError(
      Object.assign(new Error("connection failed for sk-live-123"), {
        code: "ECONNREFUSED",
      }),
      ["sk-live-123"],
    );

    expect(result.code).toBe("OFFLINE");
    expect(result.message).not.toContain("sk-live-123");
    expect(result.detail).toBe("connection failed for [REDACTED]");
    expect(result.retryable).toBe(true);
  });

  it("maps common provider failures to stable categories", () => {
    expect(normalizeAppError({ status: 401 }).code).toBe("AUTHENTICATION");
    expect(normalizeAppError({ status: 429 }).code).toBe("RATE_LIMIT");
    expect(normalizeAppError({ code: "ETIMEDOUT" }).code).toBe("TIMEOUT");
    expect(
      normalizeAppError({ name: "AbortError", message: "request timed out" }).code,
    ).toBe("TIMEOUT");
    expect(normalizeAppError({ name: "AbortError" }).code).toBe("CANCELLED");
    expect(normalizeAppError({ code: "VALIDATION" }).code).toBe("VALIDATION");
  });

  it("does not expose a secret through an already normalized error", () => {
    const error = new AppErrorException({
      code: "PROVIDER",
      message: "The provider could not complete the request.",
      detail: "Bearer sk-live-456",
      retryable: true,
    });

    expect(normalizeAppError(error, ["sk-live-456"]).detail).toBe(
      "Bearer [REDACTED]",
    );
  });

  it("returns a safe error for a malformed AppError shape", () => {
    const result = normalizeAppError({
      code: "PROVIDER",
      message: "The provider could not complete the request.",
      detail: 42,
      retryable: true,
    });

    expect(result.code).toBe("PROVIDER");
    expect(result.detail).toBe("The provider could not complete the request. PROVIDER");
  });
});
