import { useEffect, type RefObject } from "react";

/**
 * Trap keyboard focus inside a dialog while it's open, and restore focus
 * to the previously-focused element when it closes. Without this, Tab
 * walks out of the modal into the page behind the overlay.
 *
 * Usage: attach `ref` to the dialog container and pass `open`.
 */
export function useFocusTrap(ref: RefObject<HTMLElement>, open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    if (!node) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = (): HTMLElement[] =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), ' +
            'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);

    // Move focus into the dialog on open.
    (focusable()[0] ?? node).focus();

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      // Restore focus to whatever was focused before the dialog opened.
      previouslyFocused?.focus?.();
    };
  }, [ref, open]);
}
