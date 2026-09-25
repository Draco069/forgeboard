import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { normalizeAppError, redactSecrets } from "../../shared/errors";
import type {
  Connection,
  ConnectionSaveInput,
  ProviderKind,
} from "../../shared/types";
import { Icon } from "./Icon";

export const providerDefaults: Record<
  ProviderKind,
  { baseUrl: string; model: string }
> = {
  ollama: {
    baseUrl: "http://127.0.0.1:11434",
    model: "llama3.2",
  },
  "openai-compatible": {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
};

const providerLabels: Record<ProviderKind, string> = {
  ollama: "Ollama",
  "openai-compatible": "OpenAI-compatible",
};

interface ConnectionFormValues {
  name: string;
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  credential: string;
}

export interface ConnectionDialogProps {
  /** Render the dialog when true. The default keeps the component convenient in tests. */
  open?: boolean;
  /** The connection being edited, when this is an edit dialog. */
  connection?: Connection | null;
  /** Alias retained for callers that use the plan's optional-existing wording. */
  existingConnection?: Connection | null;
  onClose?: () => void;
  onSave?: (
    input: ConnectionSaveInput,
  ) => Connection | void | Promise<Connection | void>;
  saving?: boolean;
  error?: unknown;
  credentialsAvailable?: boolean;
  /** The control that opened the dialog is focused again after it closes. */
  triggerRef?: RefObject<HTMLElement | null>;
}

function valuesFromConnection(
  connection: Connection | null | undefined,
): ConnectionFormValues {
  if (connection) {
    return {
      name: connection.name,
      provider: connection.provider,
      baseUrl: connection.baseUrl,
      model: connection.model,
      // A credential is deliberately never read from the persisted connection.
      credential: "",
    };
  }

  return {
    name: "",
    provider: "ollama",
    ...providerDefaults.ollama,
    credential: "",
  };
}

function errorMessage(value: unknown): string {
  if (typeof value === "string") {
    return redactSecrets(value);
  }
  return normalizeAppError(value).message;
}

export function validateConnectionValues(
  values: Pick<ConnectionFormValues, "name" | "baseUrl" | "model">,
): string | null {
  if (values.name.trim().length === 0) {
    return "Give this connection a name.";
  }

  let url: URL;
  try {
    url = new URL(values.baseUrl.trim());
  } catch {
    return "Enter an absolute HTTP or HTTPS provider URL.";
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Provider URLs must use HTTP or HTTPS.";
  }
  if (url.username || url.password) {
    return "Do not put credentials in the provider URL.";
  }
  if (values.model.trim().length === 0) {
    return "Enter a model name.";
  }
  if (values.model.trim().length > 200) {
    return "Model names must be 200 characters or fewer.";
  }

  return null;
}

export function ConnectionDialog({
  open = true,
  connection,
  existingConnection,
  onClose,
  onSave,
  saving = false,
  error,
  credentialsAvailable = true,
  triggerRef,
}: ConnectionDialogProps) {
  const sourceConnection = connection ?? existingConnection ?? null;
  const [values, setValues] = useState<ConnectionFormValues>(() =>
    valuesFromConnection(sourceConnection),
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const nameErrorId = useId();
  const urlErrorId = useId();
  const modelErrorId = useId();
  const credentialHintId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    setValues(valuesFromConnection(sourceConnection));
    setLocalError(null);
    window.requestAnimationFrame(() => nameInputRef.current?.focus());
  }, [open, sourceConnection?.id]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || saving) {
        return;
      }
      event.preventDefault();
      onClose?.();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open, saving]);

  if (!open) {
    return null;
  }

  const closeDialog = (): void => {
    if (saving) {
      return;
    }
    onClose?.();
    window.requestAnimationFrame(() => triggerRef?.current?.focus());
  };

  const updateValue = <K extends keyof ConnectionFormValues>(
    key: K,
    value: ConnectionFormValues[K],
  ): void => {
    setValues((current) => ({ ...current, [key]: value }));
    setLocalError(null);
  };

  const handleProviderChange = (provider: ProviderKind): void => {
    const defaults = providerDefaults[provider];
    setValues((current) => ({
      ...current,
      provider,
      baseUrl: defaults.baseUrl,
      model: defaults.model,
      credential: "",
    }));
    setLocalError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const validationError = validateConnectionValues(values);
    if (validationError) {
      setLocalError(validationError);
      return;
    }

    if (!onSave) {
      closeDialog();
      return;
    }

    setLocalError(null);
    const input: ConnectionSaveInput = {
      ...(sourceConnection ? { id: sourceConnection.id } : {}),
      name: values.name.trim(),
      provider: values.provider,
      baseUrl: values.baseUrl.trim(),
      model: values.model.trim(),
      ...(values.credential.length > 0 ? { credential: values.credential } : {}),
    };

    try {
      await onSave(input);
      setValues((current) => ({ ...current, credential: "" }));
      onClose?.();
      window.requestAnimationFrame(() => triggerRef?.current?.focus());
    } catch (cause) {
      setLocalError(errorMessage(cause));
    }
  };

  const visibleError = localError ?? (error ? errorMessage(error) : null);
  const hasSavedCredential = sourceConnection?.hasCredential === true;
  const fieldError = (field: "name" | "baseUrl" | "model"): string | undefined => {
    if (!visibleError) {
      return undefined;
    }
    if (
      (field === "name" && visibleError.includes("name")) ||
      (field === "baseUrl" && (visibleError.includes("URL") || visibleError.includes("credentials"))) ||
      (field === "model" && visibleError.includes("model"))
    ) {
      return visibleError;
    }
    return undefined;
  };

  return (
    <div className="connection-dialog-backdrop">
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="connection-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <form noValidate onSubmit={(event) => void handleSubmit(event)}>
          <div className="dialog-icon" aria-hidden="true">
            <Icon name="settings" size={19} />
          </div>
          <h2 id={titleId}>{sourceConnection ? "Edit connection" : "Add connection"}</h2>
          <p id={descriptionId}>
            Save a local or OpenAI-compatible endpoint for this workspace. The request is sent only
            when you run a prompt.
          </p>

          <div className="connection-form-grid">
            <div className="field-group">
              <label htmlFor="connection-name">Connection name</label>
              <input
                aria-describedby={fieldError("name") ? nameErrorId : undefined}
                aria-invalid={Boolean(fieldError("name"))}
                autoComplete="off"
                id="connection-name"
                maxLength={200}
                onChange={(event) => updateValue("name", event.target.value)}
                ref={nameInputRef}
                required
                type="text"
                value={values.name}
              />
              {fieldError("name") ? (
                <p className="field-error" id={nameErrorId}>
                  {fieldError("name")}
                </p>
              ) : null}
            </div>

            <div className="field-group">
              <label htmlFor="connection-provider">Provider</label>
              <select
                id="connection-provider"
                onChange={(event) =>
                  handleProviderChange(event.target.value as ProviderKind)
                }
                value={values.provider}
              >
                {(Object.keys(providerLabels) as ProviderKind[]).map((provider) => (
                  <option key={provider} value={provider}>
                    {providerLabels[provider]}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-group connection-form-wide">
              <label htmlFor="connection-base-url">Base URL</label>
              <input
                aria-describedby={fieldError("baseUrl") ? urlErrorId : undefined}
                aria-invalid={Boolean(fieldError("baseUrl"))}
                autoComplete="url"
                id="connection-base-url"
                maxLength={2_000}
                onChange={(event) => updateValue("baseUrl", event.target.value)}
                required
                type="url"
                value={values.baseUrl}
              />
              {fieldError("baseUrl") ? (
                <p className="field-error" id={urlErrorId}>
                  {fieldError("baseUrl")}
                </p>
              ) : null}
            </div>

            <div className="field-group">
              <label htmlFor="connection-model">Model</label>
              <input
                aria-describedby={fieldError("model") ? modelErrorId : undefined}
                aria-invalid={Boolean(fieldError("model"))}
                autoComplete="off"
                id="connection-model"
                maxLength={200}
                onChange={(event) => updateValue("model", event.target.value)}
                required
                type="text"
                value={values.model}
              />
              {fieldError("model") ? (
                <p className="field-error" id={modelErrorId}>
                  {fieldError("model")}
                </p>
              ) : null}
            </div>

            <div className="field-group">
              <label htmlFor="connection-credential">
                Credential <span className="optional-label">Optional</span>
              </label>
              <input
                aria-describedby={credentialHintId}
                autoComplete="new-password"
                id="connection-credential"
                maxLength={16_384}
                onChange={(event) => updateValue("credential", event.target.value)}
                placeholder="Paste a key only when the provider needs one"
                type="password"
                value={values.credential}
              />
              {hasSavedCredential ? (
                <p className="credential-status" id={credentialHintId}>
                  <Icon name="check" size={13} />
                  <span>Saved securely</span>
                </p>
              ) : (
                <p className="field-hint" id={credentialHintId}>
                  {credentialsAvailable
                    ? "The value is sent once to the secure bridge and is never shown again."
                    : "Secure storage is unavailable; a credential will last for this session only."}
                </p>
              )}
            </div>
          </div>

          {visibleError && !fieldError("name") && !fieldError("baseUrl") && !fieldError("model") ? (
            <p className="dialog-error" role="alert">
              {visibleError}
            </p>
          ) : null}

          <div className="dialog-actions">
            <button className="button button-quiet" disabled={saving} type="button" onClick={closeDialog}>
              Cancel
            </button>
            <button className="button button-primary" disabled={saving} type="submit">
              <Icon name="check" size={15} />
              <span>{saving ? "Saving…" : sourceConnection ? "Save connection" : "Add connection"}</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
