import React from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { bootstrapRendererTheme, ThemeProvider } from './ThemeProvider';
import { LlmProvider } from './LlmProviderContext';
import { AiDomainModelProvider } from './AiDomainModelContext';
import './styles.css';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Renderer root element was not found.');
}

bootstrapRendererTheme();

// Platform flag for titlebar layout: macOS reserves room for the traffic lights
// inside the product chrome when the native titlebar is hidden.
document.documentElement.dataset.platform = navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'other';

createRoot(rootElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <LlmProvider>
        <AiDomainModelProvider>
          <App />
        </AiDomainModelProvider>
      </LlmProvider>
    </ThemeProvider>
  </React.StrictMode>
);
