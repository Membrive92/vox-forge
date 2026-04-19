/**
 * Skeleton — shimmer placeholder for lazy-loading content.
 *
 * Use while waiting for API data to arrive. Much better UX than
 * "Loading..." plain text or a blank screen.
 *
 * Respects prefers-reduced-motion via global.css.
 */
import { colors, radii } from "@/theme/tokens";

interface Props {
  width?: number | string;
  height?: number | string;
  radius?: number;
  inline?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Skeleton({
  width = "100%",
  height = 16,
  radius = radii.sm,
  inline = false,
  className,
  style,
}: Props) {
  return (
    <div
      aria-hidden
      className={`vf-skeleton ${className ?? ""}`.trim()}
      style={{
        display: inline ? "inline-block" : "block",
        width,
        height,
        borderRadius: radius,
        background: `linear-gradient(90deg, ${colors.surfaceAlt} 0%, ${colors.surface} 50%, ${colors.surfaceAlt} 100%)`,
        backgroundSize: "200% 100%",
        animation: "vf-shimmer 1.4s ease-in-out infinite",
        ...style,
      }}
    />
  );
}

/**
 * Convenience for rendering multiple rows of skeleton lines
 * (e.g., for a list of cards or rows).
 */
export function SkeletonRows({ rows = 3, gap = 8, height = 16 }: { rows?: number; gap?: number; height?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={height} width={`${100 - i * 5}%`} />
      ))}
    </div>
  );
}
