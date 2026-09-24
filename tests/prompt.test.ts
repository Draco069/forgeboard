import { describe, expect, it } from "vitest";
import { extractVariables, renderPrompt } from "../src/shared/prompt";

describe("prompt variables", () => {
  it("extracts unique variables in first-seen order", () => {
    expect(
      extractVariables(
        "Fix {{language}} then test {{language}} and {{error}} with {{ test-case }}",
      ),
    ).toEqual(["language", "error", "test-case"]);
  });

  it("leaves literal braces that are not valid variables untouched", () => {
    const template = "Keep {{}} {{not valid}} {{valid_name}} {single} {{a.b}}";

    expect(extractVariables(template)).toEqual(["valid_name"]);
    expect(renderPrompt(template, { valid_name: "kept" })).toEqual({
      text: "Keep {{}} {{not valid}} kept {single} {{a.b}}",
      missing: [],
    });
  });

  it("reports missing variables without losing the template", () => {
    const result = renderPrompt("Fix {{language}}: {{error}}", {
      language: "TypeScript",
    });

    expect(result.missing).toEqual(["error"]);
    expect(result.text).toBe("Fix TypeScript: {{error}}");
  });

  it("does not throw for a missing or blank value", () => {
    expect(renderPrompt("Hello {{name}}", {})).toEqual({
      text: "Hello {{name}}",
      missing: ["name"],
    });
    expect(renderPrompt("Hello {{name}}", { name: "   " })).toEqual({
      text: "Hello {{name}}",
      missing: ["name"],
    });
    expect(renderPrompt("Hello {{ name }}", {})).toEqual({
      text: "Hello {{ name }}",
      missing: ["name"],
    });
  });
});
