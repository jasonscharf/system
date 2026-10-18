import type React from "react";
import { createContext, useContext } from "react";
import type { DashboardRuntime } from "../DashboardRuntime.js";
import type { ListTopicSource } from "../ListTopicView.js";

export interface DashboardHostValue {
    readonly runtime: DashboardRuntime;
    /** Where list tiles read their topics from. */
    readonly lists: ListTopicSource;
}

const DashboardHostContext = createContext<DashboardHostValue | null>(null);

export interface DashboardHostProviderProps extends DashboardHostValue {
    readonly children: React.ReactNode;
}

/** Provides the runtime and data sources to every dashboard below it. */
export function DashboardHostProvider(props: DashboardHostProviderProps): React.ReactElement {
    const { runtime, lists, children } = props;
    return (
        <DashboardHostContext.Provider value={{ runtime, lists }}>
            {children}
        </DashboardHostContext.Provider>
    );
}

export function useDashboardHost(): DashboardHostValue {
    const host = useContext(DashboardHostContext);
    if (host === null) {
        throw new Error("useDashboardHost must be used within a DashboardHostProvider");
    }
    return host;
}
