import { Composition } from "@jasonscharf/core-ui";
import {
    CompositionProvider,
    CompositionRevision,
    MenuView,
    RegionHost,
    RevisionProvider,
} from "@jasonscharf/core-ui/react";
import type React from "react";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { flaggedContribution, homeContribution, widgetsContribution } from "./contributions.js";
import "./style.css";

function buildComposition(flagOn: () => boolean): {
    composition: Composition;
    revision: CompositionRevision;
} {
    // Admin capability is granted, so the admin-gated menu item appears. This is
    // the config-driven gating path; flipping the set recomposes the menu.
    const composition = new Composition({ menu: { capabilities: new Set(["admin"]) } });
    const revision = new CompositionRevision();
    composition.apply(homeContribution());
    composition.apply(widgetsContribution());
    composition.apply(flaggedContribution(flagOn));
    return { composition, revision };
}

function App(): React.ReactElement {
    const [flag, setFlag] = useState(false);
    const [lastEvent, setLastEvent] = useState<string>("(none)");
    const [counter, setCounter] = useState(0);

    // The flag ref is read by the conditional contribution's `when` predicate.
    const flagRef = useMemo(() => ({ on: false }), []);
    flagRef.on = flag;

    const { composition, revision } = useMemo(() => buildComposition(() => flagRef.on), [flagRef]);

    // Observe dispatch events to prove the round-trip end to end. Subscriptions
    // live in an effect with cleanup so StrictMode's double-invoke does not leave
    // duplicate listeners.
    useEffect(() => {
        const offNav = composition.dispatch.on<{ to: string }>("nav.changed", (p) =>
            setLastEvent(`nav.changed:${p.to}`),
        );
        const offCounter = composition.dispatch.on<{ delta: number }>("counter.bumped", (p) =>
            setCounter((c) => c + p.delta),
        );
        return () => {
            offNav();
            offCounter();
        };
    }, [composition]);

    return (
        <CompositionProvider composition={composition}>
            <RevisionProvider revision={revision}>
                <div className="shell">
                    <header className="shell__header">
                        <RegionHost name="header" className="shell__region" />
                    </header>
                    <div className="shell__body">
                        <MenuView className="shell__nav" />
                        <main className="shell__main">
                            <RegionHost
                                name="main"
                                className="shell__region"
                                fallback={<p className="shell__empty">No views contributed.</p>}
                            />
                        </main>
                    </div>
                    <footer className="shell__footer">
                        <button
                            type="button"
                            data-testid="toggle-flag"
                            onClick={() => {
                                setFlag((f) => !f);
                                revision.bump();
                            }}
                        >
                            Toggle conditional view
                        </button>
                        <span data-testid="last-event">last-event: {lastEvent}</span>
                        <span data-testid="counter-total">counter: {counter}</span>
                    </footer>
                </div>
            </RevisionProvider>
        </CompositionProvider>
    );
}

const container = document.getElementById("app");
if (container !== null) {
    createRoot(container).render(
        <StrictMode>
            <App />
        </StrictMode>,
    );
}
