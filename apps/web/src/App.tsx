import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { AuthProvider, useAuth } from "./features/auth/AuthContext";
import { LoginPage, RegisterPage } from "./features/auth/AuthPages";
import { LoadingScreen, SetupScreen, UnreachableScreen } from "./features/auth/StatusScreens";
import { ChatShell } from "./features/chat/ChatShell";

function Protected() {
  const { state, retry } = useAuth();
  const loc = useLocation();
  switch (state.status) {
    case "loading":
      return <LoadingScreen />;
    case "setup":
      return <SetupScreen issues={state.issues} onRetry={retry} />;
    case "unreachable":
      return <UnreachableScreen message={state.message} onRetry={retry} />;
    case "signedOut":
      return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
    case "signedIn":
      return <ChatShell me={state.user} />;
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
          <Route path="/c/:slug" element={<Protected />} />
          <Route path="*" element={<Navigate to="/c/general" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
