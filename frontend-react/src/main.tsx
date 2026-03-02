import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

// ─── Security: Enforce HTTPS for non-localhost ────────────────────────────────
if (
  window.location.protocol === 'http:' &&
  window.location.hostname !== 'localhost' &&
  !window.location.hostname.startsWith('192.168.')
) {
  window.location.replace(window.location.href.replace('http:', 'https:'));
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found');

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
