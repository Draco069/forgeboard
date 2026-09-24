export const VARIABLE_PATTERN = /\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g;

export function extractVariables(template: string): string[] {
  VARIABLE_PATTERN.lastIndex = 0;
  const names: string[] = [];

  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    const name = match[1];
    if (!names.includes(name)) {
      names.push(name);
    }
  }

  return names;
}

export interface RenderPromptResult {
  text: string;
  missing: string[];
}

export function renderPrompt(
  template: string,
  values: Record<string, string>,
): RenderPromptResult {
  const missing = extractVariables(template).filter(
    (name) => typeof values[name] !== "string" || values[name].trim().length === 0,
  );

  const text = template.replace(VARIABLE_PATTERN, (fullMatch, name: string) => {
    const value = values[name];
    return typeof value === "string" && value.trim().length > 0 ? value : fullMatch;
  });

  return { text, missing };
}
