import { createContext, useContext, useEffect, useState } from "react";
import type { ChatController } from "../../state/controller";

export const ChatCtx = createContext<ChatController | null>(null);

export function useController(): ChatController {
  const c = useContext(ChatCtx);
  if (!c) throw new Error("useController outside ChatShell");
  return c;
}

/** Re-renders every `ms` while `active` (for typing expiry and presence expiry). */
export function useNow(ms: number, active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, active]);
  return now;
}
