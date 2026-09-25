import { useEffect, useMemo, useState } from "react";
import { extractVariables } from "../../shared/prompt";
import type { PromptDraft } from "../../shared/types";
import { Icon } from "./Icon";
import { VariableFields } from "./VariableFields";

export interface PromptEditorProps {
  draft: PromptDraft;
  onChange: (draft: PromptDraft) => void;
  onSave: (draft: PromptDraft) => unknown;
  variableValues?: Record<string, string>;
  onVariableValuesChange?: (values: Record<string, string>) => void;
  onCancel?: () => void;
  saving?: boolean;
  error?: string | null;
  notice?: string | null;
  isNew?: boolean;
}

function parseTags(value: string): string[] {
  const tags: string[] = [];
  for (const candidate of value.split(",")) {
    const tag = candidate.trim();
    if (tag && !tags.includes(tag)) {
      tags.push(tag);
    }
  }
  return tags;
}

export function PromptEditor({
  draft,
  onChange,
  onSave,
  variableValues,
  onVariableValuesChange,
  onCancel,
  saving = false,
  error = null,
  notice = null,
  isNew = false,
}: PromptEditorProps) {
  const [internalValues, setInternalValues] = useState<Record<string, string>>(variableValues ?? {});
  const [tagsText, setTagsText] = useState(draft.tags.join(", "));
  const [localError, setLocalError] = useState<string | null>(null);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const variables = useMemo(() => extractVariables(draft.body), [draft.body]);
  const values = variableValues ?? internalValues;
  const visibleError = error ?? localError;
  const visibleNotice = notice ?? localNotice;

  useEffect(() => {
    const parsedTags = parseTags(tagsText);
    if (
      parsedTags.length !== draft.tags.length ||
      parsedTags.some((tag, index) => tag !== draft.tags[index])
    ) {
      setTagsText(draft.tags.join(", "));
    }
  }, [draft.tags, tagsText]);

  const updateValues = (nextValues: Record<string, string>): void => {
    if (variableValues === undefined) {
      setInternalValues(nextValues);
    }
    onVariableValuesChange?.(nextValues);
    setLocalError(null);
  };

  const updateDraft = (patch: Partial<PromptDraft>): void => {
    setLocalError(null);
    setLocalNotice(null);
    onChange({ ...draft, ...patch });
  };

  const handleSave = async (): Promise<void> => {
    const titleError = draft.title.trim().length === 0;
    const missingVariables = variables.filter((variable) => !(values[variable] ?? "").trim());
    if (titleError || missingVariables.length > 0) {
      setLocalNotice(null);
      setLocalError(
        titleError
          ? "Add a title before saving this prompt."
          : `Fill in the required variables: ${missingVariables.join(", ")}.`,
      );
      return;
    }

    setLocalError(null);
    setLocalNotice(null);
    try {
      await onSave(draft);
      setLocalNotice("Prompt saved.");
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "The prompt could not be saved.");
    }
  };

  return (
    <section className="prompt-editor-panel" aria-labelledby="prompt-editor-title">
      <div className="prompt-editor-heading">
        <div>
          <p className="section-kicker">{isNew ? "New prompt" : "Edit prompt"}</p>
          <h2 id="prompt-editor-title">{isNew ? "Shape a reusable instruction." : "Refine your instruction."}</h2>
        </div>
        <span className="editor-state" aria-label={isNew ? "New prompt draft" : "Prompt draft"}>
          Draft
        </span>
      </div>

      {visibleError ? (
        <div className="editor-message editor-message-error" role="alert">
          <Icon name="archive" size={16} />
          <span>{visibleError}</span>
        </div>
      ) : null}
      {visibleNotice ? (
        <div className="editor-message editor-message-success" role="status">
          <Icon name="check" size={16} />
          <span>{visibleNotice}</span>
        </div>
      ) : null}

      <div className="editor-form">
        <div className="field-group">
          <label htmlFor="prompt-title">Prompt title</label>
          <input
            aria-invalid={!draft.title.trim()}
            autoComplete="off"
            id="prompt-title"
            maxLength={200}
            onChange={(event) => updateDraft({ title: event.target.value })}
            placeholder="Give this prompt a memorable name"
            required
            type="text"
            value={draft.title}
          />
        </div>

        <div className="field-group">
          <label htmlFor="prompt-description">Description <span className="optional-label">Optional</span></label>
          <input
            autoComplete="off"
            id="prompt-description"
            maxLength={5_000}
            onChange={(event) => updateDraft({ description: event.target.value })}
            placeholder="What is this prompt for?"
            type="text"
            value={draft.description}
          />
        </div>

        <div className="field-group">
          <label htmlFor="prompt-body">Prompt body</label>
          <textarea
            id="prompt-body"
            maxLength={100_000}
            onChange={(event) => updateDraft({ body: event.target.value })}
            placeholder="Write the instruction you want to reuse…"
            rows={12}
            spellCheck
            value={draft.body}
          />
        </div>

        <div className="editor-fields-row">
          <div className="field-group">
            <label htmlFor="prompt-tags">Tags <span className="optional-label">Comma separated</span></label>
            <input
              autoComplete="off"
              id="prompt-tags"
              onChange={(event) => {
                const nextText = event.target.value;
                setTagsText(nextText);
                updateDraft({ tags: parseTags(nextText) });
              }}
              placeholder="typescript, review"
              type="text"
              value={tagsText}
            />
          </div>
          <label className="favorite-toggle" htmlFor="prompt-favorite">
            <input
              checked={draft.favorite}
              id="prompt-favorite"
              onChange={(event) => updateDraft({ favorite: event.target.checked })}
              type="checkbox"
            />
            <span className="favorite-toggle-mark" aria-hidden="true">
              <Icon name="bookmark" size={15} />
            </span>
            <span>Favorite</span>
          </label>
        </div>

        <VariableFields onChange={updateValues} values={values} variables={variables} />

        <div className="editor-actions">
          <button className="button button-primary" disabled={saving} type="button" onClick={() => void handleSave()}>
            <Icon name="check" size={16} />
            <span>{saving ? "Saving…" : "Save prompt"}</span>
          </button>
          {onCancel ? (
            <button className="button button-quiet" disabled={saving} type="button" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
          <span className="shortcut-note" aria-label="Save prompt shortcut">
            <kbd>Ctrl</kbd><span aria-hidden="true">+</span><kbd>Enter</kbd> runs the prompt when execution is connected.
          </span>
        </div>
      </div>
    </section>
  );
}
