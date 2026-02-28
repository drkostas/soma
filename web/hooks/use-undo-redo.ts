// web/hooks/use-undo-redo.ts
import { useState, useCallback, useEffect } from "react";

export function useUndoRedo<T>(initial: T): [T, (v: T) => void, () => void, () => void] {
  const [state, setState] = useState({ history: [initial], index: 0 });

  const set = useCallback((value: T) => {
    setState(prev => {
      const next = prev.history.slice(0, prev.index + 1);
      const trimmed = next.length >= 20 ? next.slice(1) : next;
      return { history: [...trimmed, value], index: trimmed.length };
    });
  }, []);

  const undo = useCallback(() => setState(prev => ({ ...prev, index: Math.max(0, prev.index - 1) })), []);
  const redo = useCallback(() => setState(prev => ({ ...prev, index: Math.min(prev.history.length - 1, prev.index + 1) })), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z") { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key === "z" || e.key === "y")) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  return [state.history[state.index], set, undo, redo];
}
