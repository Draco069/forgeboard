import type { ForgeboardView, RendererState } from "../state";
import { Icon, type IconName } from "./Icon";

export interface SidebarProps {
  state: RendererState;
  onViewChange: (view: ForgeboardView) => void;
  onWorkspaceChange?: (workspaceId: string) => void;
  onCreatePrompt?: () => void;
}

interface NavigationItem {
  view: ForgeboardView;
  label: string;
  icon: IconName;
  count?: number;
}

export function Sidebar({
  state,
  onViewChange,
  onWorkspaceChange,
  onCreatePrompt,
}: SidebarProps) {
  const navigation: NavigationItem[] = [
    {
      view: "prompts",
      label: "Prompts",
      icon: "grid",
      count: state.document.prompts.filter(
        (prompt) => prompt.workspaceId === state.activeWorkspace.id,
      ).length,
    },
    {
      view: "history",
      label: "History",
      icon: "history",
      count: state.document.requests.filter(
        (request) => request.workspaceId === state.activeWorkspace.id,
      ).length,
    },
    { view: "settings", label: "Settings", icon: "settings" },
  ];

  return (
    <aside className="sidebar" aria-label="Forgeboard workspace navigation">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <p className="brand-name">Forgeboard</p>
          <p className="brand-caption">Local AI workbench</p>
        </div>
      </div>

      <div className="sidebar-rule" aria-hidden="true" />

      <nav aria-label="Primary">
        <p className="nav-label">Workbench</p>
        <ul className="nav-list">
          {navigation.map((item) => {
            const isActive = state.view === item.view;
            return (
              <li key={item.view}>
                <button
                  aria-current={isActive ? "page" : undefined}
                  className={`nav-item ${isActive ? "is-active" : ""}`.trim()}
                  type="button"
                  onClick={() => onViewChange(item.view)}
                >
                  <Icon name={item.icon} size={17} />
                  <span>{item.label}</span>
                  {item.count !== undefined ? (
                    <span className="nav-count" aria-label={`${item.count} items`}>
                      {item.count}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <section className="workspace-section" aria-labelledby="workspace-label">
        <div className="section-heading-row">
          <p className="nav-label" id="workspace-label">
            Workspaces
          </p>
          <span className="workspace-total">{state.document.workspaces.length}</span>
        </div>
        <ul className="workspace-list">
          {state.document.workspaces.map((workspace) => {
            const isActive = workspace.id === state.activeWorkspace.id;
            return (
              <li key={workspace.id}>
                <button
                  aria-current={isActive ? "true" : undefined}
                  className={`workspace-item ${isActive ? "is-active" : ""}`.trim()}
                  type="button"
                  onClick={() => onWorkspaceChange?.(workspace.id)}
                >
                  <span className="workspace-glyph" aria-hidden="true">
                    <Icon name="folder" size={15} />
                  </span>
                  <span className="workspace-name">{workspace.name}</span>
                  {isActive ? <span className="workspace-active-dot" aria-hidden="true" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="sidebar-spacer" />

      <button
        aria-label="Create a new prompt"
        className="new-prompt-button"
        type="button"
        onClick={onCreatePrompt}
        title="Create a new prompt"
      >
        <Icon name="plus" size={17} />
        <span>New prompt</span>
        <span className="shortcut-hint" aria-hidden="true">
          N
        </span>
      </button>

      <footer className="sidebar-footer">
        <div className="local-status">
          <span className="status-pip" aria-hidden="true" />
          <span>Local store</span>
        </div>
        <p>Private by default</p>
      </footer>
    </aside>
  );
}
