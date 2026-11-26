import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface Props {
  children: ReactNode;
  // Changing this (e.g. the route) clears the error.
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[PMS] Unhandled UI error', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex flex-col items-center justify-center text-center py-20 px-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-crimson-600/40 bg-crimson-600/10 mb-4">
          <AlertTriangle className="h-6 w-6 text-crimson-500" />
        </div>
        <h2 className="font-sans text-base font-semibold text-white">Something went wrong on this screen</h2>
        <p className="text-sm text-graphite-400 mt-1 max-w-sm">
          Your data is safe. Try again, and if it keeps happening, tell your admin what you were doing.
        </p>
        <Button className="mt-5" variant="secondary" onClick={() => this.setState({ error: null })}>
          <RotateCcw className="h-4 w-4" />
          Try again
        </Button>
      </div>
    );
  }
}
