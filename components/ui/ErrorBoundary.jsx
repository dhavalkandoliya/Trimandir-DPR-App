'use client';

import { Component } from 'react';

// Minimal error boundary: AppShell wraps each tab in one, so a render bug in
// one screen (say, the Dashboard) can't take down the rest of the app.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('AnalyticsDashboard crashed:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          ⚠️ Dashboard failed to render. Try switching tabs and back.
        </div>
      );
    }
    return this.props.children;
  }
}
