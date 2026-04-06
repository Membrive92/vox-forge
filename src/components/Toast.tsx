import { colors } from "@/theme/tokens";

import { Check } from "./icons";

interface ToastProps {
  message: string;
  visible: boolean;
}

export function Toast({ message, visible }: ToastProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 20,
        right: 20,
        zIndex: 100,
        background: "#1e3a5f",
        border: `1px solid ${colors.primary}`,
        borderRadius: 10,
        padding: "12px 20px",
        fontSize: 13,
        fontWeight: 500,
        display: "flex",
        alignItems: "center",
        gap: 8,
        transform: visible ? "translateX(0)" : "translateX(120%)",
        opacity: visible ? 1 : 0,
        transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      }}
    >
      <Check /> {message}
    </div>
  );
}
