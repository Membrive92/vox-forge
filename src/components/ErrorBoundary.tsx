import { Component, type ErrorInfo, type ReactNode } from "react";

import { getTranslations } from "@/i18n";
import { logger } from "@/logging/logger";
import { colors, fonts, radii, space, typography } from "@/theme/tokens";

interface Props {
  children: ReactNode;
}

// ErrorBoundary wraps the app before any language state exists, so we
// pick a locale from the browser's preferred language once at mount.
const _browserLang = navigator.language?.toLowerCase().startsWith("es") ? "es" : "en";
const _t = getTranslations(_browserLang);

interface State {
  error: Error | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, showDetails: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, showDetails: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error("React render error", {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  private handleReset = (): void => {
    this.setState({ error: null, showDetails: false });
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  private toggleDetails = (): void => {
    this.setState((prev) => ({ ...prev, showDetails: !prev.showDetails }));
  };

  render(): ReactNode {
    const { error, showDetails } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          margin: space[6],
          padding: space[6],
          background: colors.surface,
          border: `1px solid ${colors.dangerBorder}`,
          borderRadius: radii.xl,
          fontFamily: fonts.sans,
          color: colors.text,
          maxWidth: 640,
          backdropFilter: "blur(12px)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: space[3],
            marginBottom: space[3],
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: colors.dangerSoft,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: colors.danger,
              flexShrink: 0,
            }}
          >
            <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2
            style={{
              margin: 0,
              fontSize: typography.size.lg,
              fontWeight: typography.weight.bold,
              color: colors.text,
            }}
          >
            {_t.errorBoundaryTitle}
          </h2>
        </div>

        <p
          style={{
            margin: `0 0 ${space[4]}px`,
            fontSize: typography.size.sm,
            color: colors.textDim,
            lineHeight: typography.leading.normal,
          }}
        >
          {_t.errorBoundaryDesc}
        </p>

        <div style={{ display: "flex", gap: space[2], marginBottom: space[4] }}>
          <button
            onClick={this.handleReset}
            style={{
              padding: `${space[3]}px ${space[5]}px`,
              borderRadius: radii.md,
              background: `linear-gradient(135deg, ${colors.primary}, ${colors.primaryDim})`,
              border: "none",
              color: "#fff",
              fontSize: typography.size.sm,
              fontWeight: typography.weight.semibold,
              cursor: "pointer",
              fontFamily: fonts.sans,
            }}
          >
            {_t.errorBoundaryTryAgain}
          </button>
          <button
            onClick={this.handleReload}
            style={{
              padding: `${space[3]}px ${space[5]}px`,
              borderRadius: radii.md,
              background: colors.surfaceAlt,
              border: `1px solid ${colors.border}`,
              color: colors.textMuted,
              fontSize: typography.size.sm,
              fontWeight: typography.weight.semibold,
              cursor: "pointer",
              fontFamily: fonts.sans,
            }}
          >
            {_t.errorBoundaryReload}
          </button>
        </div>

        <button
          onClick={this.toggleDetails}
          style={{
            background: "none",
            border: "none",
            color: colors.textFaint,
            fontSize: typography.size.xs,
            fontFamily: fonts.mono,
            cursor: "pointer",
            padding: 0,
            textDecoration: "underline",
            textDecorationStyle: "dotted",
          }}
        >
          {showDetails ? _t.hideDetails : _t.showDetails}
        </button>

        {showDetails && (
          <pre
            style={{
              marginTop: space[3],
              fontFamily: fonts.mono,
              fontSize: typography.size.xs,
              color: colors.textDim,
              background: colors.surfaceAlt,
              padding: space[3],
              borderRadius: radii.md,
              maxHeight: 240,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ""}
          </pre>
        )}
      </div>
    );
  }
}
