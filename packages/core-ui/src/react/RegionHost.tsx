import type React from "react";
import { View } from "react-native";
import { bindView } from "../views.js";
import { useComposition, useRevision } from "./context.js";

export interface RegionHostProps {
    /** Name of the region to host. */
    readonly name: string;
    /** Optional className for the region wrapper. */
    readonly className?: string;
    /**
     * Rendered when the region has no visible contributions. Lets the shell show
     * placeholder/empty states for unfilled regions.
     */
    readonly fallback?: React.ReactNode;
}

/**
 * Hosts a named region: renders whatever views product packages contributed
 * into it, in resolved order, each bound to its view-model. The shell declares
 * `<RegionHost name="..." />` placeholders; what fills them is configuration.
 *
 * Re-reads on recomposition (via useRevision), so a config change recomposes
 * the region without the shell knowing what changed.
 */
export function RegionHost(props: RegionHostProps): React.ReactElement {
    const { name, className, fallback } = props;
    const composition = useComposition();
    // Subscribe to recomposition; the value is unused but the subscription
    // forces a re-read of the region when contributions change.
    useRevision();

    const views = composition.regions.viewsFor(name);

    if (views.length === 0) {
        return (
            <View className={className} dataSet={{ region: name, empty: "true" }}>
                {fallback ?? null}
            </View>
        );
    }

    return (
        <View className={className} dataSet={{ region: name }}>
            {views.map((view) => {
                const bound = bindView<
                    Record<string, unknown>,
                    Record<string, unknown>,
                    React.ReactNode
                >(view, composition.dispatch);
                return (
                    <View key={bound.id} className="region-host__view" dataSet={{ view: bound.id }}>
                        {bound.render()}
                    </View>
                );
            })}
        </View>
    );
}
