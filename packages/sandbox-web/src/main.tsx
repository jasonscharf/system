import type React from "react";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ClientApp } from "./ClientApp.js";
import { ComponentShowcaseView } from "./components/ComponentShowcase.js";
import { DiscussionsPage } from "./components/DiscussionsPage.js";
import "./style.css";

// In k8s the web container is behind an nginx reverse proxy that forwards
// /ws → server:8080 and /auth → server:8081.  When VITE_SERVER_URL is not
// baked in at build time (the default for Docker images) we derive the WS URL
// from the current window location so the same image works in every env.
// For local dev outside k8s, set VITE_SERVER_URL=ws://localhost:8080 in a
// packages/sandbox-web/.env.local file.
const SERVER_URL =
    import.meta.env.VITE_SERVER_URL ??
    `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;

type Page = "showcase" | "discussions";

function App({ model }: { model: ClientApp["showcase"] }): React.ReactElement {
    const [page, setPage] = useState<Page>("showcase");

    return (
        <>
            <nav className="app-nav">
                <span className="app-nav__brand">Tern Sandbox</span>
                <div className="app-nav__links">
                    <button
                        type="button"
                        className={`app-nav__link${page === "showcase" ? " app-nav__link--active" : ""}`}
                        onClick={() => setPage("showcase")}
                    >
                        Components
                    </button>
                    <button
                        type="button"
                        className={`app-nav__link${page === "discussions" ? " app-nav__link--active" : ""}`}
                        onClick={() => setPage("discussions")}
                    >
                        Discussions
                    </button>
                </div>
            </nav>

            <main className="app-main">
                {page === "showcase" && <ComponentShowcaseView model={model} />}
                {page === "discussions" && <DiscussionsPage />}
            </main>
        </>
    );
}

async function main(): Promise<void> {
    const app = new ClientApp(SERVER_URL);

    const root = document.getElementById("app");
    if (!root) {
        throw new Error("#app element not found");
    }

    createRoot(root).render(
        <StrictMode>
            <App model={app.showcase} />
        </StrictMode>,
    );

    // Start the FBP app after React has rendered the initial frame
    await app.start();
}

// getLogger() is not exported from @jasonscharf/core's `browser` entry: it
// resolves through the IoC container, and pulling typescript-ioc +
// reflect-metadata into every browser bundle is a bigger decision than this
// one line. Browser-side logging is deliberately still an open question; the
// platform logging law covers server and worker code.
// biome-ignore lint/suspicious/noConsole: browser boot, see above
main().catch((err) => console.error(err));
