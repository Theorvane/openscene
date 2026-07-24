import React from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { bootstrapRendererTheme, ThemeProvider } from './ThemeProvider';
import { LlmProvider } from './LlmProviderContext';
import './styles.css';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Renderer root element was not found.');
}

bootstrapRendererTheme();

createRoot(rootElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <LlmProvider>
        <App />
      </LlmProvider>
    </ThemeProvider>
  </React.StrictMode>
);
