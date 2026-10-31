import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Me } from "@relay/shared";
import { api, ApiError, setSessionLostHandler } from "../../lib/api";

export type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; user: Me }
  /** Server answered, but it's missing configuration (env vars). */
  | { status: "setup"; issues: { variable: string; message: string }[] }
  /** Server unreachable (dev server not running, network down). */
  | { status: "unreachable"; message: string };

interface AuthApi {
  state: AuthState;
  signIn(email: string, password: string): Promise<void>;
  register(email: string, password: string, displayName: string): Promise<void>;
  signOut(): Promise<void>;
  /** Called when the session can't be refreshed (expired, revoked). */
  sessionLost(): void;
  retry(): void;
}

const Ctx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const restore = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const { user } = await api.me(); // a 401 triggers one refresh attempt inside api.*
      setState({ status: "signedIn", user });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return setState({ status: "signedOut" });
      if (e instanceof ApiError && e.code === "config") {
        return setState({ status: "setup", issues: (e.details as { variable: string; message: string }[]) ?? [] });
      }
      setState({ status: "unreachable", message: e instanceof Error ? e.message : "Can't reach the server" });
    }
  }, []);

  useEffect(() => {
    void restore();
  }, [restore]);

  const sessionLost = useCallback(() => setState({ status: "signedOut" }), []);
  useEffect(() => setSessionLostHandler(sessionLost), [sessionLost]);

  const value = useMemo<AuthApi>(
    () => ({
      state,
      async signIn(email, password) {
        const { user } = await api.login(email, password);
        setState({ status: "signedIn", user });
      },
      async register(email, password, displayName) {
        const { user } = await api.register(email, password, displayName);
        setState({ status: "signedIn", user });
      },
      async signOut() {
        try {
          await api.logout();
        } finally {
          setState({ status: "signedOut" });
        }
      },
      sessionLost,
      retry: () => void restore(),
    }),
    [state, sessionLost, restore],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
