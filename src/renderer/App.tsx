import { useCallback, useEffect, useState } from "react";

type ConnectionState =
  | { status: "checking" | "ready"; version?: string }
  | { status: "unavailable" };

function App() {
  const [connection, setConnection] = useState<ConnectionState>({
    status: "checking",
  });

  const checkConnection = useCallback(async (): Promise<void> => {
    setConnection({ status: "checking" });

    try {
      const result = await window.forgeboard.ping();
      setConnection({ status: "ready", version: result.version });
    } catch {
      setConnection({ status: "unavailable" });
    }
  }, []);

  useEffect(() => {
    void checkConnection();
  }, [checkConnection]);

  const readinessMessage =
    connection.status === "ready"
      ? `Ready · version ${connection.version}`
      : connection.status === "unavailable"
        ? "The local bridge is unavailable."
        : "Checking the local bridge…";

  return (
    <div className="app-shell" data-testid="app-shell">
      <header className="shell-header">
        <p className="eyebrow">Developer workspace</p>
        <h1>Forgeboard</h1>
        <p className="intro">
          A local-first workbench for organizing prompts and exploring model
          responses.
        </p>
      </header>

      <main>
        <section className="welcome-card" aria-labelledby="welcome-title">
          <div className="card-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <p className="card-kicker">Your workspace is ready to grow</p>
            <h2 id="welcome-title">Build a calmer AI workflow.</h2>
            <p className="card-copy">
              Keep prompts, connections, and history on your machine. Connect
              a local model when you are ready.
            </p>
          </div>
          <div className="card-footer">
            <p className="readiness" role="status" aria-live="polite">
              <span className={`status-dot status-${connection.status}`} />
              {readinessMessage}
            </p>
            <button
              className="refresh-button"
              type="button"
              onClick={() => void checkConnection()}
              disabled={connection.status === "checking"}
            >
              Check connection
            </button>
          </div>
        </section>
      </main>

      <footer className="shell-footer">
        <span>Private by default</span>
        <span aria-hidden="true">·</span>
        <span>Made for focused work</span>
      </footer>
    </div>
  );
}

export default App;
