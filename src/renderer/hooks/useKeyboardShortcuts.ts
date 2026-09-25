import { useEffect } from "react";

export interface KeyboardShortcutHandlers {
  /** Focus the prompt search field. */
  onFocusSearch?: () => void;
  /** Alias for consumers that call the action simply "search". */
  onSearch?: () => void;
  /** Start a new prompt draft. */
  onNewPrompt?: () => void;
  /** Alias for onNewPrompt. */
  onCreatePrompt?: () => void;
  /** Run the current prompt; Task 8 supplies the real request action. */
  onRun?: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

/**
 * Binds the small, cross-platform prompt-library shortcut set.
 * Text-entry controls keep their own keyboard behavior; shortcuts only fire
 * when the focused element is an application surface.
 */
export function useKeyboardShortcuts({
  onFocusSearch,
  onSearch,
  onNewPrompt,
  onCreatePrompt,
  onRun,
}: KeyboardShortcutHandlers): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.defaultPrevented) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      let action: (() => void) | undefined;

      if (key === "k") {
        action = onFocusSearch ?? onSearch;
      } else if (key === "n") {
        action = onNewPrompt ?? onCreatePrompt;
      } else if (key === "enter") {
        action = onRun;
      }

      if (!action) {
        return;
      }

      event.preventDefault();
      action();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCreatePrompt, onFocusSearch, onNewPrompt, onRun, onSearch]);
}

export { isEditableTarget };
