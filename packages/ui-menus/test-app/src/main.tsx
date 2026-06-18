import { Composition } from "@jasonscharf/core-ui";
import {
    Aside,
    CompositionProvider,
    CompositionRevision,
    Div,
    Footer,
    H2,
    Header,
    Hr,
    Main,
    P,
    RegionHost,
    RevisionProvider,
    Span,
} from "@jasonscharf/core-ui/react";
import { MenuRegistry } from "@jasonscharf/ui-menus";
import { MenuProvider, MenuView } from "@jasonscharf/ui-menus/react";
import type React from "react";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
    homeContribution,
    primaryMenu,
    settingsMenu,
    widgetsContribution,
} from "./contributions.js";
import "./style.css";

function build(): {
    composition: Composition;
    revision: CompositionRevision;
    menus: MenuRegistry;
} {
    const composition = new Composition();
    const revision = new CompositionRevision();
    const menus = new MenuRegistry({ menu: { capabilities: new Set(["admin"]) } });
    composition.apply(homeContribution());
    composition.apply(widgetsContribution());
    menus.apply(primaryMenu());
    menus.apply(settingsMenu());
    return { composition, revision, menus };
}

function App(): React.ReactElement {
    const [lastEvent, setLastEvent] = useState<string>("(none)");
    const [counter, setCounter] = useState(0);

    const { composition, revision, menus } = useMemo(() => build(), []);

    useEffect(() => {
        const offNav = composition.dispatch.on("nav.changed", (p) =>
            setLastEvent(`nav.changed:${p.to}`),
        );
        const offCounter = composition.dispatch.on("counter.bumped", (p) =>
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
                <MenuProvider menus={menus}>
                    <Div className="app-shell">
                        <Header className="app-header">
                            <RegionHost name="header" className="region-slot" />
                        </Header>
                        <Div className="app-body">
                            <Aside className="sidebar">
                                <MenuView className="sidebar-nav" slot="primary" label="Primary" />
                                <Hr className="nav-divider" />
                                <H2 className="nav-section-title">Settings</H2>
                                <MenuView
                                    className="sidebar-nav"
                                    slot="settings"
                                    label="Settings"
                                />
                            </Aside>
                            <Main className="app-main">
                                <RegionHost
                                    name="main"
                                    className="region-slot"
                                    fallback={<P className="empty-hint">No views contributed.</P>}
                                />
                            </Main>
                        </Div>
                        <Footer className="app-footer">
                            <Span testID="last-event">last-event: {lastEvent}</Span>
                            <Span testID="counter-total">counter: {counter}</Span>
                        </Footer>
                    </Div>
                </MenuProvider>
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
