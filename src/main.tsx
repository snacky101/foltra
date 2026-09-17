import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { isTauri } from '@tauri-apps/api/core';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/typography.css';
import './styles/notes.css';
import './styles/frontmatter.css';
import './styles/topics.css';
import './styles/editor.css';
import './styles/settings.css';
import './styles/plugins.css';

document.documentElement.classList.toggle('macos-overlay', isTauri() && /Mac/.test(navigator.platform));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
