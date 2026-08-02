'use client';

import { Component } from 'react';

// Minimal error boundary so a bug in a newly-ported React component (e.g. the
// portal-mounted AnalyticsDashboard) can't crash the still-legacy rest of the
// page, which is injected separately via innerHTML and has no React tree of
// its own to catch errors for.
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
