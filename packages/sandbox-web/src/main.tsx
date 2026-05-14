import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClientApp } from './ClientApp.js';
import { ComponentShowcaseView } from './components/ComponentShowcase.js';
import './style.css';


// In k8s the web container is behind an nginx reverse proxy that forwards
// /ws → server:8080 and /auth → server:8081.  When VITE_SERVER_URL is not
// baked in at build time (the default for Docker images) we derive the WS URL
// from the current window location so the same image works in every env.
// For local dev outside k8s, set VITE_SERVER_URL=ws://localhost:8080 in a
// packages/sandbox-web/.env.local file.
const SERVER_URL = import.meta.env['VITE_SERVER_URL']
    ?? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

async function main(): Promise<void> {
    const app = new ClientApp(SERVER_URL);

    const root = document.getElementById('app');
    if (!root) { throw new Error('#app element not found'); }

    createRoot(root).render(
        <StrictMode>
            <ComponentShowcaseView model={app.showcase} />
        </StrictMode>,
    );

    // Start the FBP app after React has rendered the initial frame
    await app.start();
}

main().catch(console.error);
