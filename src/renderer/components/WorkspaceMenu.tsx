import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { normalizeAppError } from "../../shared/errors";
import type { Workspace } from "../../shared/types";
import { Icon } from "./Icon";

export interface WorkspaceMenuProps {
  workspaces: Workspace[];
  activeWorkspaceId?: string;
  activeWorkspace?: Workspace;
  onWorkspaceChange?: (workspaceId: string) => void;
  onSelectWorkspace?: (workspaceId: string) => void;
  onCreate?: (name: string) => unknown;
  onRename?: (workspaceId: string, name: string) => unknown;
  onDelete?: (workspaceId: string) => unknown;
  onCreateWorkspace?: (name: string) => unknown;
  onRenameWorkspace?: (workspaceId: string, name: string) => unknown;
  onDeleteWorkspace?: (workspaceId: string) => unknown;
  disabled?: boolean;
  confirmDelete?: (workspace: Workspace) => boolean | Promise<boolean>;
}

type DialogMode = "create" | "rename" | "delete" | null;

export function WorkspaceMenu({
  workspaces,
  activeWorkspaceId,
  activeWorkspace: activeWorkspaceProp,
  onWorkspaceChange,
  onSelectWorkspace,
  onCreate,
  onRename,
  onDelete,
  onCreateWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  disabled = false,
  confirmDelete,
}: WorkspaceMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const activeWorkspaceIdValue =
    activeWorkspaceId ?? activeWorkspaceProp?.id ?? workspaces[0]?.id ?? "";
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceIdValue) ??
    activeWorkspaceProp ??
    workspaces[0];
  const createHandler = onCreateWorkspace ?? onCreate;
  const renameHandler = onRenameWorkspace ?? onRename;
  const deleteHandler = onDeleteWorkspace ?? onDelete;

  useEffect(() => {
    if (dialog === "create" || dialog === "rename") {
      nameInputRef.current?.focus();
    } else if (dialog === "delete") {
      window.requestAnimationFrame(() => {
        dialogRef.current?.querySelector<HTMLButtonElement>(".button-danger")?.focus();
      });
    }
  }, [dialog]);

  useEffect(() => {
    if (!menuOpen && !dialog) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (dialog) {
          setDialog(null);
          setName("");
          setError(null);
          window.requestAnimationFrame(() => triggerRef.current?.focus());
        } else {
          setMenuOpen(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dialog, menuOpen]);

  const closeDialog = (): void => {
    setDialog(null);
    setName("");
    setError(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const openCreateDialog = (): void => {
    setName("");
    setError(null);
    setMenuOpen(false);
    setDialog("create");
  };

  const openRenameDialog = (): void => {
    if (!activeWorkspace) {
      return;
    }
    setName(activeWorkspace.name);
    setError(null);
    setMenuOpen(false);
    setDialog("rename");
  };

  const openDeleteDialog = (): void => {
    if (!activeWorkspace) {
      return;
    }
    setError(null);
    setMenuOpen(false);
    setDialog("delete");
  };

  const handleNameSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError("Workspace names cannot be blank.");
      return;
    }

    if (dialog === "create" && !createHandler) {
      closeDialog();
      return;
    }
    if (dialog === "rename" && !renameHandler) {
      closeDialog();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (dialog === "create" && createHandler) {
        await createHandler(trimmedName);
      } else if (dialog === "rename" && renameHandler && activeWorkspace) {
        await renameHandler(activeWorkspace.id, trimmedName);
      }
      setDialog(null);
      setName("");
      setMenuOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    } catch (cause) {
      setError(normalizeAppError(cause).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!activeWorkspace) {
      return;
    }

    if (confirmDelete) {
      setBusy(true);
      try {
        const confirmed = await confirmDelete(activeWorkspace);
        if (!confirmed) {
          return;
        }
        await deleteHandler?.(activeWorkspace.id);
        setDialog(null);
        setMenuOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      } catch (cause) {
        setError(normalizeAppError(cause).message);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!deleteHandler) {
      setDialog(null);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await deleteHandler(activeWorkspace.id);
      setDialog(null);
      setMenuOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    } catch (cause) {
      setError(normalizeAppError(cause).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="workspace-menu">
      <button
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label="Workspace actions"
        className="workspace-menu-trigger"
        disabled={disabled}
        ref={triggerRef}
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span className="workspace-menu-trigger-label">Workspace actions</span>
        <span className="workspace-menu-trigger-name">{activeWorkspace?.name ?? "No workspace"}</span>
        <Icon name="chevron-down" size={15} />
      </button>

      {menuOpen ? (
        <div aria-label="Workspace actions" className="workspace-menu-popover" role="menu">
          <p className="workspace-menu-label">Switch workspace</p>
          <div className="workspace-menu-options">
            {workspaces.map((workspace) => (
              <button
                aria-checked={workspace.id === activeWorkspaceIdValue}
                aria-current={workspace.id === activeWorkspaceIdValue ? "true" : undefined}
                className={`workspace-menu-option ${workspace.id === activeWorkspaceIdValue ? "is-active" : ""}`.trim()}
                key={workspace.id}
                type="button"
                onClick={() => {
                  onWorkspaceChange?.(workspace.id);
                  onSelectWorkspace?.(workspace.id);
                  setMenuOpen(false);
                }}
              >
                <Icon name="folder" size={15} />
                <span>{workspace.name}</span>
                {workspace.id === activeWorkspaceIdValue ? <Icon name="check" size={14} /> : null}
              </button>
            ))}
          </div>
          <div className="workspace-menu-separator" aria-hidden="true" />
          <button className="workspace-menu-action" type="button" onClick={openCreateDialog}>
            <Icon name="plus" size={15} />
            <span>Create workspace</span>
          </button>
          <button className="workspace-menu-action" type="button" onClick={openRenameDialog}>
            <Icon name="archive" size={15} />
            <span>Rename workspace</span>
          </button>
          <button className="workspace-menu-action workspace-menu-action-danger" type="button" onClick={openDeleteDialog}>
            <Icon name="x" size={15} />
            <span>Delete workspace</span>
          </button>
        </div>
      ) : null}

      {dialog ? (
        <div className="workspace-dialog-backdrop">
          <section
            aria-describedby={dialogDescriptionId}
            aria-labelledby={dialogTitleId}
            aria-modal="true"
            className="workspace-dialog"
            ref={dialogRef}
            role="dialog"
          >
            {dialog === "delete" ? (
              <>
                <div className="dialog-icon dialog-icon-danger" aria-hidden="true">
                  <Icon name="archive" size={19} />
                </div>
                <h2 id={dialogTitleId}>Delete workspace?</h2>
                <p id={dialogDescriptionId}>
                  This removes <strong>{activeWorkspace?.name}</strong> and its saved prompts and run history. This action cannot be undone.
                </p>
                {error ? <p className="dialog-error" role="alert">{error}</p> : null}
                <div className="dialog-actions">
                  <button className="button button-quiet" disabled={busy} type="button" onClick={closeDialog}>
                    Cancel
                  </button>
                  <button
                    className="button button-danger"
                    disabled={busy}
                    type="button"
                    onClick={() => void handleDelete()}
                  >
                    <Icon name="x" size={15} />
                    <span>{busy ? "Deleting…" : "Delete workspace"}</span>
                  </button>
                </div>
              </>
            ) : (
              <form noValidate onSubmit={(event) => void handleNameSubmit(event)}>
                <div className="dialog-icon" aria-hidden="true">
                  <Icon name={dialog === "create" ? "plus" : "archive"} size={19} />
                </div>
                <h2 id={dialogTitleId}>{dialog === "create" ? "Create workspace" : "Rename workspace"}</h2>
                <p id={dialogDescriptionId}>
                  {dialog === "create"
                    ? "Give this workspace a short name so its prompts stay easy to find."
                    : "Choose a new name for this workspace."}
                </p>
                <div className="field-group">
                  <label htmlFor="workspace-name">Workspace name</label>
                  <input
                    aria-required="true"
                    autoComplete="off"
                    id="workspace-name"
                    maxLength={200}
                    onChange={(event) => setName(event.target.value)}
                    ref={nameInputRef}
                    required
                    type="text"
                    value={name}
                  />
                </div>
                {error ? <p className="dialog-error" role="alert">{error}</p> : null}
                <div className="dialog-actions">
                  <button className="button button-quiet" disabled={busy} type="button" onClick={closeDialog}>
                    Cancel
                  </button>
                  <button className="button button-primary" disabled={busy} type="submit">
                    <Icon name="check" size={15} />
                    <span>{busy ? "Saving…" : dialog === "create" ? "Create workspace" : "Save workspace"}</span>
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
