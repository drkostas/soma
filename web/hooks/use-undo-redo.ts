// web/hooks/use-undo-redo.ts
import { useState } from "react";

export function useUndoRedo<T>(initial: T): [T, (value: T) => void, () => void, () => void] {
  const [state, setState] = useState<T>(initial);
  // Stubs for undo/redo — full implementation in Task 12
  return [state, setState, () => {}, () => {}];
}
