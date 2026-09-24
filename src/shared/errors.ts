export const APP_ERROR_CODES = [
  "VALIDATION",
  "OFFLINE",
  "AUTHENTICATION",
  "RATE_LIMIT",
  "PROVIDER",
  "TIMEOUT",
  "CANCELLED",
  "STORAGE",
  "IMPORT",
  "UNKNOWN",
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export interface AppError {
  code: AppErrorCode;
  message: string;
  detail?: string;
  retryable: boolean;
}

const REDACTION = "[REDACTED]";

const ERROR_MESSAGES: Record<AppErrorCode, string> = {
  VALIDATION: "Please check the input and try again.",
  OFFLINE: "The provider could not be reached.",
  AUTHENTICATION: "The provider rejected the credentials.",
  RATE_LIMIT: "The provider is rate limiting requests. Try again later.",
  PROVIDER: "The provider could not complete the request.",
  TIMEOUT: "The request timed out.",
  CANCELLED: "The request was cancelled.",
  STORAGE: "The local data could not be accessed.",
  IMPORT: "The imported data could not be accepted.",
  UNKNOWN: "Something went wrong.",
};

const RETRYABLE_CODES: Record<AppErrorCode, boolean> = {
  VALIDATION: false,
  OFFLINE: true,
  AUTHENTICATION: false,
  RATE_LIMIT: true,
  PROVIDER: true,
  TIMEOUT: true,
  CANCELLED: true,
  STORAGE: true,
  IMPORT: false,
  UNKNOWN: true,
};

const SECRET_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+(?!\[REDACTED\])[^\s,;]+/gi,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{6,}\b/g,
  /\b(?:gh[pousr]_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{6,}\b/g,
  /\bAIza[A-Za-z0-9_-]{10,}\b/g,
];

const KEY_VALUE_SECRET_PATTERN =
  /(\b(?:api[-_ ]?key|access[-_ ]?token|auth[-_ ]?token|secret|password|token)\s*[:=]\s*)(?!\[REDACTED\])(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;

const MAX_ERROR_DETAIL_LENGTH = 2_000;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readStatus(error: Record<string, unknown> | undefined): number | undefined {
  const directStatus = readNumber(error, "status");
  if (directStatus !== undefined) {
    return directStatus;
  }

  const statusCode = readNumber(error, "statusCode");
  if (statusCode !== undefined) {
    return statusCode;
  }

  const response = asRecord(error?.response);
  return readNumber(response, "status") ?? readNumber(response, "statusCode");
}

function readErrorText(error: unknown, seen: Set<unknown>): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0) {
      return message;
    }
  }

  const record = asRecord(error);
  if (!record || seen.has(record)) {
    return "";
  }

  seen.add(record);

  const parts = [
    readString(record, "detail"),
    readString(record, "errorMessage"),
    readString(record, "message"),
    readString(record, "reason"),
    readString(record, "code"),
    readErrorText(record.cause, seen),
  ];

  return parts.filter((part): part is string => Boolean(part?.trim())).join(" ");
}

function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === "string" && APP_ERROR_CODES.includes(value as AppErrorCode);
}

function isAppError(value: unknown): value is AppError {
  const record = asRecord(value);
  return Boolean(
    record &&
      isAppErrorCode(record.code) &&
      typeof record.message === "string" &&
      typeof record.retryable === "boolean",
  );
}

function inferErrorCode(error: unknown, text: string): AppErrorCode {
  const record = asRecord(error);
  const explicitCode = readString(record, "code");
  if (isAppErrorCode(explicitCode)) {
    return explicitCode;
  }

  const status = readStatus(record);
  if (status === 401 || status === 403) {
    return "AUTHENTICATION";
  }
  if (status === 429) {
    return "RATE_LIMIT";
  }
  if (status !== undefined && status >= 400) {
    return "PROVIDER";
  }
  if (status === 0) {
    return "OFFLINE";
  }

  const normalizedCode = explicitCode?.toLowerCase() ?? "";
  const normalizedName = readString(record, "name")?.toLowerCase() ?? "";
  const normalizedText = text.toLowerCase().replace(/[_-]+/g, " ");

  if (
    normalizedText.includes("timed out") ||
    normalizedText.includes("timeout") ||
    normalizedCode.includes("timeout") ||
    normalizedCode.includes("timedout") ||
    normalizedName.includes("timeout")
  ) {
    return "TIMEOUT";
  }

  if (
    normalizedName === "aborterror" ||
    normalizedCode === "aborterror" ||
    normalizedCode === "err_aborted" ||
    normalizedCode === "err_canceled" ||
    normalizedCode === "cancelled" ||
    normalizedCode === "canceled" ||
    normalizedText.includes("abort") ||
    normalizedText.includes("canceled") ||
    normalizedText.includes("cancelled")
  ) {
    return "CANCELLED";
  }

  if (
    normalizedText.includes("rate limit") ||
    normalizedText.includes("too many requests") ||
    normalizedCode.includes("ratelimit")
  ) {
    return "RATE_LIMIT";
  }

  if (
    normalizedText.includes("unauthorized") ||
    normalizedText.includes("forbidden") ||
    normalizedText.includes("authentication") ||
    normalizedText.includes("invalid api key") ||
    normalizedCode.includes("unauthorized") ||
    normalizedCode.includes("forbidden") ||
    normalizedCode.includes("auth")
  ) {
    return "AUTHENTICATION";
  }

  if (
    normalizedCode === "enotfound" ||
    normalizedCode === "econnrefused" ||
    normalizedCode === "econnreset" ||
    normalizedCode === "enetunreach" ||
    normalizedCode === "eai_again" ||
    normalizedCode === "err_network" ||
    normalizedCode.includes("err_name_not_resolved") ||
    normalizedCode.includes("err_internet_disconnected") ||
    normalizedCode.includes("err_connection") ||
    normalizedText.includes("network") ||
    normalizedText.includes("offline") ||
    normalizedText.includes("fetch failed") ||
    normalizedText.includes("connection refused") ||
    normalizedText.includes("connection reset") ||
    normalizedText.includes("name not resolved")
  ) {
    return "OFFLINE";
  }

  if (
    normalizedText.includes("validation") ||
    normalizedText.includes("malformed") ||
    normalizedText.includes("schema") ||
    normalizedText.includes("invalid json") ||
    normalizedText.includes("invalid_type") ||
    normalizedText.includes("invalid_value") ||
    normalizedText.includes("too_big") ||
    normalizedText.includes("too_small") ||
    normalizedCode.includes("validation") ||
    normalizedCode.includes("schema") ||
    normalizedCode.startsWith("err_invalid") ||
    normalizedName === "zoderror"
  ) {
    return "VALIDATION";
  }

  if (
    normalizedText.includes("storage") ||
    normalizedText.includes("filesystem") ||
    normalizedText.includes("file system") ||
    normalizedCode.startsWith("eacces") ||
    normalizedCode === "enospc" ||
    normalizedCode === "eexist" ||
    normalizedCode === "enoent" ||
    normalizedCode === "eisdir" ||
    normalizedCode === "enotdir" ||
    normalizedCode === "eio"
  ) {
    return "STORAGE";
  }

  if (normalizedText.includes("import")) {
    return "IMPORT";
  }

  if (
    normalizedText.includes("provider") ||
    normalizedText.includes("server") ||
    normalizedText.includes("request failed") ||
    normalizedCode.startsWith("http")
  ) {
    return "PROVIDER";
  }

  return "UNKNOWN";
}

function limitDetail(value: string): string {
  if (value.length <= MAX_ERROR_DETAIL_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_ERROR_DETAIL_LENGTH - 1)}…`;
}

/** Removes explicitly supplied secrets and common credential-shaped tokens. */
export function redactSecrets(value: string, secrets: string[] = []): string {
  let redacted = value;
  const uniqueSecrets = [...new Set(secrets.filter((secret) => secret.length > 0))].sort(
    (left, right) => right.length - left.length,
  );

  for (const secret of uniqueSecrets) {
    redacted = redacted.split(secret).join(REDACTION);
  }

  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTION);
  }

  redacted = redacted.replace(KEY_VALUE_SECRET_PATTERN, `$1${REDACTION}`);

  return redacted;
}

function normalizeSecretOptions(
  options: string[] | { secrets?: string[] } = [],
): string[] {
  if (Array.isArray(options)) {
    return options;
  }

  return options.secrets ?? [];
}

/** Converts arbitrary process/provider failures into a renderer-safe value. */
export function normalizeAppError(
  error: unknown,
  secretsOrOptions: string[] | { secrets?: string[] } = [],
): AppError {
  const secrets = normalizeSecretOptions(secretsOrOptions);
  const appError = isAppError(error) ? error : undefined;
  const rawText = readErrorText(error, new Set<unknown>());
  const code = appError?.code ?? inferErrorCode(error, rawText);
  const rawDetail = appError?.detail ?? rawText;
  const detail = rawDetail ? limitDetail(redactSecrets(rawDetail, secrets)) : undefined;

  return {
    code,
    message: ERROR_MESSAGES[code],
    ...(detail ? { detail } : {}),
    retryable: RETRYABLE_CODES[code],
  };
}

export class AppErrorException extends Error implements AppError {
  readonly code: AppErrorCode;
  readonly detail?: string;
  readonly retryable: boolean;

  constructor(error: AppError) {
    super(error.message);
    this.name = "AppErrorException";
    this.code = error.code;
    this.detail = error.detail;
    this.retryable = error.retryable;
  }

  toJSON(): AppError {
    return {
      code: this.code,
      message: this.message,
      ...(this.detail ? { detail: this.detail } : {}),
      retryable: this.retryable,
    };
  }
}

export function createAppError(
  code: AppErrorCode,
  detail?: string,
  retryable = RETRYABLE_CODES[code],
): AppError {
  return {
    code,
    message: ERROR_MESSAGES[code],
    ...(detail ? { detail } : {}),
    retryable,
  };
}

export function createValidationError(detail?: string): AppErrorException {
  return new AppErrorException(createAppError("VALIDATION", detail));
}
