/**
 * Imperative confirmation: `const confirm = useConfirm();` then
 * `if (await confirm({ title, message, ... })) { ...destructive... }`.
 *
 * One <ConfirmProvider> is mounted at the app root; it renders a single
 * shared <ConfirmDialog> so every destructive action can gate itself with
 * minimal wiring instead of each call site managing its own dialog state.
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

import { ConfirmDialog } from "./ConfirmDialog";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: "primary" | "danger";
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

// Used when no <ConfirmProvider> is mounted (e.g. unit tests rendering a
// component in isolation). Falls back to the native confirm when one
// exists, otherwise proceeds — the real app always mounts the provider.
const fallbackConfirm: ConfirmFn = async (opts) => {
  try {
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      return window.confirm(`${opts.title}\n\n${opts.message}`);
    }
  } catch {
    /* non-browser / happy-dom: fall through to proceed */
  }
  return true;
};

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext) ?? fallbackConfirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setOpts(options);
    });
  }, []);

  const settle = useCallback((result: boolean) => {
    setOpts(null);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(result);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <ConfirmDialog
          open
          title={opts.title}
          message={opts.message}
          confirmVariant={opts.confirmVariant ?? "primary"}
          {...(opts.confirmText !== undefined ? { confirmText: opts.confirmText } : {})}
          {...(opts.cancelText !== undefined ? { cancelText: opts.cancelText } : {})}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </ConfirmContext.Provider>
  );
}
