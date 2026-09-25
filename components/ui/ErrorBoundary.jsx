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
    console.error('Screen crashed:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="list"><div className="empty"><h3>This screen failed to load</h3><p className="muted">Switch to another tab and back, or reload the page.</p></div></div>
      );
    }
    return this.props.children;
  }
}
