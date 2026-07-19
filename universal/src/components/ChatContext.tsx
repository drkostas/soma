import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/** Lets the bottom tab bar's center ⊕ button open the chat sheet, which lives at
    the layout root. Keeps the chat's open state out of the tab-button tree. */
interface ChatCtx {
  open: boolean;
  openChat: () => void;
  closeChat: () => void;
}

const Ctx = createContext<ChatCtx>({ open: false, openChat: () => {}, closeChat: () => {} });

export function ChatProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo<ChatCtx>(
    () => ({ open, openChat: () => setOpen(true), closeChat: () => setOpen(false) }),
    [open],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useChat = () => useContext(Ctx);
