import { Composition } from "@jasonscharf/core-ui";
import {
    Button,
    CompositionProvider,
    CompositionRevision,
    Div,
    Footer,
    Header,
    Main,
    P,
    RegionHost,
    RevisionProvider,
    Span,
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
    const composition = new Composition();
    const revision = new CompositionRevision();
    composition.apply(homeContribution());
    composition.apply(widgetsContribution());
    composition.apply(flaggedContribution(flagOn));
    return { composition, revision };
}

function App(): React.ReactElement {
    const [flag, setFlag] = useState(false);
    const [counter, setCounter] = useState(0);

    const flagRef = useMemo(() => ({ on: false }), []);
    flagRef.on = flag;

    const { composition, revision } = useMemo(() => buildComposition(() => flagRef.on), [flagRef]);

    useEffect(() => {
        const offCounter = composition.dispatch.on("counter.bumped", (p) =>
            setCounter((c) => c + p.delta),
        );
        return () => {
            offCounter();
        };
    }, [composition]);

    return (
        <CompositionProvider composition={composition}>
            <RevisionProvider revision={revision}>
                <Div className="app-shell">
                    <Header className="app-header">
                        <RegionHost name="header" className="region-slot" />
                    </Header>
                    <Div className="app-body">
                        <Main className="app-main">
                            <RegionHost
                                name="main"
                                className="region-slot"
                                fallback={<P className="empty-hint">No views contributed.</P>}
                            />
                        </Main>
                    </Div>
                    <Footer className="app-footer">
                        <Button
                            className="toggle-btn"
                            testID="toggle-flag"
                            onClick={() => {
                                setFlag((f) => !f);
                                revision.bump();
                            }}
                        >
                            Toggle conditional view
                        </Button>
                        <Span testID="counter-total">counter: {counter}</Span>
                    </Footer>
                </Div>
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
