'use client';

import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { captureError } from '@/lib/posthog';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    captureError(error, { componentStack: errorInfo.componentStack ?? undefined });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <div className="rounded-full bg-red-500/10 p-4 mb-4">
            <AlertTriangle className="h-8 w-8 text-red-400" />
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">Something went wrong</h2>
          <p className="text-sm text-slate-400 mb-4 max-w-md">
            {this.state.error?.message || 'An unexpected error occurred. Please try again.'}
          </p>
          <Button
            variant="outline"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="border-slate-700 text-slate-300"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Try again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
