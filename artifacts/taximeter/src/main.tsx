import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);

// Register Service Worker for OSM tile caching (offline support)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW is a progressive enhancement — silently ignore registration failures
    });
  });
}
