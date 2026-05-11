import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClientApp } from './ClientApp.js';
import { ComponentShowcaseView } from './components/ComponentShowcase.js';
import './style.css';


const SERVER_URL = import.meta.env['VITE_SERVER_URL'] ?? 'ws://127.0.0.1:8080';

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
