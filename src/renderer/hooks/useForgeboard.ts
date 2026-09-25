import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createAppError, normalizeAppError } from "../../shared/errors";
import type {
  AppError,
  AppState,
  ForgeboardApi,
  RunEvent,
  Theme,
} from "../../shared/types";
import {
  createRendererState,
  rendererReducer,
  type ForgeboardView,
  type RendererAction,
  type RendererState,
} from "../state";

export interface UseForgeboardResult {
  state: RendererState | null;
  loading: boolean;
  error: AppError | null;
  refresh: () => Promise<void>;
  runEventUnsubscribe: () => void;
  navigate: (view: ForgeboardView) => void;
  selectPrompt: (promptId: string | undefined) => void;
  selectRequest: (requestId: string | undefined) => void;
  setSearch: (search: string) => void;
  setTheme: (theme: Theme) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAppState(value: unknown): value is AppState {
  if (!isRecord(value) || !isRecord(value.document) || !isRecord(value.activeWorkspace)) {
    return false;
  }

  const document = value.document;
  const settings = document.settings;
  return (
    typeof value.credentialsAvailable === "boolean" &&
    Array.isArray(document.workspaces) &&
    Array.isArray(document.prompts) &&
    Array.isArray(document.connections) &&
    Array.isArray(document.requests) &&
    isRecord(settings) &&
    (settings.theme === "system" || settings.theme === "light" || settings.theme === "dark") &&
    typeof value.activeWorkspace.id === "string" &&
    typeof value.activeWorkspace.name === "string"
  );
}

function isRunEvent(value: unknown): value is RunEvent {
  return isRecord(value) && typeof value.requestId === "string";
}

function getBridge(): ForgeboardApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.forgeboard;
}

function invalidStateError(): AppError {
  return createAppError("STORAGE", "Forgeboard could not read the local workspace state.");
}

export function useForgeboard(): UseForgeboardResult {
  const [state, dispatch] = useReducer(
    rendererReducer,
    null as RendererState | null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppError | null>(null);
  const mountedRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const subscriptionActiveRef = useRef(false);
  const stateLoadedRef = useRef(false);
  const pendingEventsRef = useRef<RunEvent[]>([]);

  const refresh = useCallback(async (): Promise<void> => {
    const sequence = ++requestSequenceRef.current;
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const bridge = getBridge();
      if (!bridge || typeof bridge.getState !== "function") {
        throw createAppError("UNKNOWN", "The local Forgeboard bridge is unavailable.");
      }

      const nextState = await bridge.getState();
      if (!isAppState(nextState)) {
        throw invalidStateError();
      }
      if (mountedRef.current && sequence === requestSequenceRef.current) {
        dispatch({ type: "state/loaded", payload: nextState });
        stateLoadedRef.current = true;
        const pendingEvents = pendingEventsRef.current.splice(0);
        for (const event of pendingEvents) {
          dispatch({ type: "run-event", event });
        }
      }
    } catch (cause) {
      if (mountedRef.current && sequence === requestSequenceRef.current) {
        setError(normalizeAppError(cause));
      }
    } finally {
      if (mountedRef.current && sequence === requestSequenceRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const runEventUnsubscribe = useCallback((): void => {
    const unsubscribe = unsubscribeRef.current;
    unsubscribeRef.current = null;
    subscriptionActiveRef.current = false;
    unsubscribe?.();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let mounted = true;
    void refresh();

    try {
      const bridge = getBridge();
      if (!bridge || typeof bridge.onRunEvent !== "function") {
        throw createAppError("UNKNOWN", "The local Forgeboard bridge is unavailable.");
      }
      subscriptionActiveRef.current = true;
      const unsubscribe = bridge.onRunEvent((event: RunEvent) => {
        if (!mounted || !subscriptionActiveRef.current || !isRunEvent(event)) {
          return;
        }
        if (stateLoadedRef.current) {
          dispatch({ type: "run-event", event });
        } else if (pendingEventsRef.current.length < 50) {
          pendingEventsRef.current.push(event);
        }
      });
      if (typeof unsubscribe === "function") {
        unsubscribeRef.current = unsubscribe;
      } else {
        subscriptionActiveRef.current = false;
      }
    } catch (cause) {
      subscriptionActiveRef.current = false;
      if (mounted) {
        setError(normalizeAppError(cause));
      }
    }

    return () => {
      mounted = false;
      mountedRef.current = false;
      subscriptionActiveRef.current = false;
      stateLoadedRef.current = false;
      pendingEventsRef.current = [];
      requestSequenceRef.current += 1;
      const unsubscribe = unsubscribeRef.current;
      unsubscribeRef.current = null;
      unsubscribe?.();
    };
  }, [refresh]);

  const navigate = useCallback((view: ForgeboardView): void => {
    dispatch({ type: "view/set", view });
  }, []);

  const selectPrompt = useCallback((promptId: string | undefined): void => {
    dispatch({ type: "prompt/select", promptId });
  }, []);

  const selectRequest = useCallback((requestId: string | undefined): void => {
    dispatch({ type: "request/select", requestId });
  }, []);

  const setSearch = useCallback((search: string): void => {
    dispatch({ type: "search/set", search });
  }, []);

  const setTheme = useCallback((theme: Theme): void => {
    dispatch({ type: "theme/set", theme });
  }, []);

  return {
    state,
    loading,
    error,
    refresh,
    runEventUnsubscribe,
    navigate,
    selectPrompt,
    selectRequest,
    setSearch,
    setTheme,
  };
}

export { createRendererState };
export type { RendererAction, RendererState };
