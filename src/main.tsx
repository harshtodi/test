import React from 'react';
import { createRoot } from 'react-dom/client';
// Base styles first so component stylesheets (imported by App) can override
// the generic .btn rules at equal specificity.
import './styles.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
