import type { KeyboardEvent } from "react";

/**
 * onKeyDown handler that fires `fn` on Enter or Space, so a non-button
 * element marked `role="button" tabIndex={0}` behaves like a real button
 * for keyboard users. Prevents the page from scrolling on Space.
 */
export function activateOnKey(fn: () => void) {
  return (e: KeyboardEvent): void => {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      fn();
    }
  };
}
