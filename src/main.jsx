/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  main.jsx — Application Entry Point                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * ARCHITECTURE ROLE:
 *   Standard Vite/React entry point. Mounts the root <App /> component
 *   into the #root div defined in index.html.
 *
 * STRICT MODE:
 *   React.StrictMode is enabled, which double-invokes certain lifecycle
 *   methods in development to surface side-effect bugs. This does NOT
 *   affect production builds.
 *
 * STYLE IMPORT:
 *   index.css is imported here so all CSS custom properties (design tokens)
 *   and component styles are available globally before any component renders.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
