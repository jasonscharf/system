import type React from "react";
import { bindView } from "../views.js";
import { useComposition, useRevision } from "./context.js";
import { Div } from "./primitives.js";

export interface RegionHostProps {
    readonly name: string;
    readonly className?: string;
    readonly fallback?: React.ReactNode;
}

export function RegionHost(props: RegionHostProps): React.ReactElement {
    const { name, className, fallback } = props;
    useRevision();
    const composition = useComposition();

    const views = composition.regions.viewsFor(name);

    if (views.length === 0) {
        return (
            <Div className={className} data={{ region: name, empty: "true" }}>
                {fallback ?? null}
            </Div>
        );
    }

    return (
        <Div className={className} data={{ region: name }}>
            {views.map((view) => {
                const bound = bindView<
                    Record<string, unknown>,
                    Record<string, unknown>,
                    React.ReactNode
                >(view, composition.dispatch);
                return (
                    <Div key={bound.id} className="region-view" data={{ view: bound.id }}>
                        {bound.render()}
                    </Div>
                );
            })}
        </Div>
    );
}
