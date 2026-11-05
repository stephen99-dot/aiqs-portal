import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Bundled typefaces (served from the app itself — works offline, no third-party
// request on first paint). Family names: 'Instrument Sans Variable',
// 'DM Serif Display', 'JetBrains Mono' — see --font-* in styles.css.
import '@fontsource-variable/instrument-sans/wght.css';
import '@fontsource-variable/instrument-sans/wght-italic.css';
import '@fontsource/dm-serif-display/400.css';
import '@fontsource/dm-serif-display/400-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
