import { useCallback, useRef, useState } from "react";

const DEFAULT_DURATION_MS = 3000;

export interface ToastState {
  message: string;
  visible: boolean;
  show: (message: string) => void;
}

export function useToast(durationMs = DEFAULT_DURATION_MS): ToastState {
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | null>(null);

  const show = useCallback(
    (msg: string) => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      setMessage(msg);
      setVisible(true);
      timerRef.current = window.setTimeout(() => setVisible(false), durationMs);
    },
    [durationMs],
  );

  return { message, visible, show };
}
