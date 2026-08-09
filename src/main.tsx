import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

type ErrorBoundaryState = { hasError: boolean };

class RuntimeErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Somewhere runtime error', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f4f0e8', color: '#1e2722', textAlign: 'center' }}><div><p style={{ letterSpacing: '.12em', fontSize: 12 }}>SOMEWHERE · 临时迷路</p><h1 style={{ margin: '12px 0', fontSize: 32 }}>页面刚才没有走稳。</h1><p>刷新一次，通常就能继续探索；你的收藏不会因此丢失。</p><button type="button" onClick={() => window.location.reload()} style={{ marginTop: 16, padding: '12px 18px', border: 0, background: '#1e2722', color: '#fff', cursor: 'pointer' }}>重新打开</button></div></div>;
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');

if (rootElement) {
  // Vite can re-evaluate this entry during CSS/module hot updates. Persist the
  // root on the stable DOM host so development never mounts a second React tree.
  const host = rootElement as HTMLElement & { __somewhereReactRoot?: ReturnType<typeof createRoot> };
  const root = host.__somewhereReactRoot ?? (host.__somewhereReactRoot = createRoot(rootElement));
  root.render(<StrictMode><RuntimeErrorBoundary><App /></RuntimeErrorBoundary></StrictMode>);
} else {
  const fallback = document.createElement('main');
  fallback.textContent = '页面容器不存在，请重新打开。';
  fallback.style.cssText = 'min-height:100vh;display:grid;place-items:center;font:16px sans-serif;';
  document.body?.appendChild(fallback);
}
