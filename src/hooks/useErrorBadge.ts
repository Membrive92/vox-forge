/**
 * Polls the backend for recent error count and returns it as a number.
 * Used by the nav to show a badge on the Activity tab when something
 * has failed in the last hour.
 */
import { useEffect, useState } from "react";

import { fetchErrorCount } from "@/api/logs";

export function useErrorBadge(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const poll = (): void => {
      // Pestaña en segundo plano: no quemar peticiones que nadie ve; al
      // volver, visibilitychange refresca al instante (BAJO-14).
      if (document.hidden) return;
      void fetchErrorCount(60)
        .then((d) => setCount(d.errors))
        .catch(() => { /* harmless — keep the previous count */ });
    };
    poll();
    const id = window.setInterval(poll, 30_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", poll);
    };
  }, []);

  return count;
}
