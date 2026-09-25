import { useId } from "react";

export interface VariableFieldsProps {
  variables: string[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}

function fieldId(prefix: string, variable: string, index: number): string {
  const safeName = variable.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `${prefix}-${index}-${safeName}`;
}

export function VariableFields({ variables, values, onChange }: VariableFieldsProps) {
  const fieldsetId = useId();

  if (variables.length === 0) {
    return (
      <p className="variable-empty" role="status">
        No variables detected. Add a token such as <code>{"{{variable}}"}</code> to create a field.
      </p>
    );
  }

  return (
    <fieldset className="variable-fields" aria-describedby={`${fieldsetId}-hint`}>
      <legend>Template variables</legend>
      <p className="field-hint" id={`${fieldsetId}-hint`}>
        Values stay in this editor while you refine the template. Blank values block saving or running.
      </p>
      <div className="variable-field-grid">
        {variables.map((variable, index) => {
          const id = fieldId(fieldsetId, variable, index);
          const value = values[variable] ?? "";
          const isMissing = value.trim().length === 0;
          const errorId = `${id}-error`;

          return (
            <div className="variable-field" key={variable}>
              <label htmlFor={id}>
                <code className="variable-token">{`{{${variable}}}`}</code>
              </label>
              <input
                aria-describedby={errorId}
                aria-invalid={isMissing}
                id={id}
                name={`variable-${variable}`}
                onChange={(event) => {
                  onChange({ ...values, [variable]: event.target.value });
                }}
                placeholder={`Enter a value for ${variable}`}
                required
                type="text"
                value={value}
              />
              {isMissing ? (
                <p className="field-error" id={errorId}>
                  A value is required for <strong>{variable}</strong>.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
