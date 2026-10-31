import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { AuthProvider, useAuth } from "./features/auth/AuthContext";
import { LoginPage, RegisterPage } from "./features/auth/AuthPages";
import { LoadingScreen, SetupScreen, UnreachableScreen } from "./features/auth/StatusScreens";
import { ChatShell } from "./features/chat/ChatShell";
import { Button } from "./components/ui/Button";
import { AcceptInvitationPage } from "./features/auth/AcceptInvitationPage";

function Protected({ children }: { children?: React.ReactNode }) {
  const { state, retry, signOut } = useAuth();
  const loc = useLocation();
  switch (state.status) {
    case "loading":
      return <LoadingScreen />;
    case "setup":
      return <SetupScreen issues={state.issues} onRetry={retry} />;
    case "unreachable":
      return <UnreachableScreen message={state.message} onRetry={retry} />;
    case "signedOut":
      return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search + loc.hash }} />;
    case "signedIn":
      if (state.user.status !== "active") return <main className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-bold">{state.user.status === "pending" ? "Waiting for owner approval" : state.user.status === "blocked" ? "Your account is blocked" : "Your request was rejected"}</h1>
        <p className="text-ink-muted">The workspace owner manages access to this community.</p>
        <Button onClick={retry}>Check access</Button><Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
      </main>;
      return children ?? <ChatShell me={state.user} />;
  }
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { state, retry } = useAuth();
  if (state.status === "loading") return <LoadingScreen />;
  if (state.status === "setup") return <SetupScreen issues={state.issues} onRetry={retry} />;
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
          <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
          <Route path="/invite" element={<Protected><AcceptInvitationPage /></Protected>} />
          <Route path="/c/:slug" element={<Protected />} />
          <Route path="/c/:communityKey/:slug" element={<Protected />} />
          <Route path="/communities" element={<Protected />} />
          <Route path="/communities/:communityKey" element={<Protected />} />
          <Route path="*" element={<Navigate to="/c/general" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
