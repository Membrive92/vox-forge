import { Component, type ErrorInfo, type ReactNode } from "react";

import { logger } from "@/logging/logger";
import { colors, fonts, radii } from "@/theme/tokens";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error("React render error", {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  private handleReset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          margin: 24,
          padding: 24,
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.xl,
          fontFamily: fonts.sans,
          color: colors.text,
          maxWidth: 720,
        }}
      >
        <h2 style={{ margin: "0 0 12px", fontSize: 18, fontWeight: 700 }}>
          Something went wrong
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: colors.textDim }}>
          The UI crashed rendering. The error has been logged — open the Logs tab
          after recovering to inspect it.
        </p>
        <pre
          style={{
            fontFamily: fonts.mono,
            fontSize: 11,
            color: colors.textDim,
            background: colors.surfaceAlt,
            padding: 12,
            borderRadius: radii.md,
            maxHeight: 200,
            overflow: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          {error.message}
          {error.stack ? `\n\n${error.stack}` : ""}
        </pre>
        <button
          onClick={this.handleReset}
          style={{
            marginTop: 16,
            padding: "10px 18px",
            borderRadius: radii.md,
            background: colors.primary,
            border: "none",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: fonts.sans,
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
