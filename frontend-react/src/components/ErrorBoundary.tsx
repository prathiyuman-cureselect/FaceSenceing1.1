import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

/**
 * Global Error Boundary — catches unhandled React render errors
 * and displays a recovery UI instead of a blank screen.
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    }

    private handleReload = (): void => {
        this.setState({ hasError: false, error: null });
        window.location.reload();
    };

    render(): ReactNode {
        if (this.state.hasError) {
            if (this.props.fallback) return this.props.fallback;

            return (
                <div
                    role="alert"
                    style={{
                        position: 'fixed',
                        inset: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: '#f8fafc',
                        fontFamily: 'Inter, sans-serif',
                        padding: '2rem',
                        textAlign: 'center',
                    }}
                >
                    <h1 style={{ fontSize: '1.5rem', color: '#0f172a', marginBottom: '0.5rem' }}>
                        Something went wrong
                    </h1>
                    <p style={{ color: '#64748b', marginBottom: '1.5rem', maxWidth: '400px' }}>
                        An unexpected error occurred. Please try reloading the application.
                    </p>
                    <button
                        onClick={this.handleReload}
                        style={{
                            padding: '12px 28px',
                            background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '12px',
                            cursor: 'pointer',
                            fontSize: '1rem',
                            fontWeight: 600,
                        }}
                    >
                        Reload Application
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
