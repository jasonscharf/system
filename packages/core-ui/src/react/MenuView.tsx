import type React from "react";
import { Pressable, Text, View } from "react-native";
import type { MenuNode } from "../menu.js";
import { useComposition, useRevision } from "./context.js";

export interface MenuViewProps {
    /** Optional className for the nav wrapper. */
    readonly className?: string;
    /**
     * Called when a leaf item is activated, after its command (if any) has been
     * dispatched. Lets the shell track selection. Receives the node id.
     */
    readonly onActivate?: (id: string) => void;
}

interface MenuNodeViewProps {
    readonly node: MenuNode;
    readonly onSelect: (id: string) => void;
    readonly depth: number;
}

function MenuNodeView(props: MenuNodeViewProps): React.ReactElement {
    const { node, onSelect, depth } = props;
    const hasChildren = node.children.length > 0;
    return (
        <View className="menu__item" role="listitem" dataSet={{ menuItem: node.item.id, depth }}>
            <Pressable
                className="menu__link"
                role="button"
                dataSet={{ command: node.item.command ?? "" }}
                onPress={() => onSelect(node.item.id)}
            >
                <Text className="menu__label">{node.item.label}</Text>
            </Pressable>
            {hasChildren ? (
                <View className="menu__group" role="list">
                    {node.children.map((child) => (
                        <MenuNodeView
                            key={child.item.id}
                            node={child}
                            onSelect={onSelect}
                            depth={depth + 1}
                        />
                    ))}
                </View>
            ) : null}
        </View>
    );
}

/**
 * Renders the config-driven menu from the active composition. The tree is
 * assembled from contributed MenuItemConfig data; activating an item dispatches
 * its command through the Dispatch seam. Nothing about the nav is hardcoded.
 *
 * Re-reads on recomposition so menu config changes recompose the nav.
 */
export function MenuView(props: MenuViewProps): React.ReactElement {
    const { className, onActivate } = props;
    const composition = useComposition();
    useRevision();

    const tree = composition.menu();

    const handleSelect = (id: string): void => {
        const item = findItem(tree, id);
        if (item !== null && item.command !== undefined && item.command !== null) {
            // Fire-and-forget; errors surface via the dispatch seam's rejection.
            void composition.dispatch.command(item.command).exec(item.commandArg);
        }
        if (onActivate !== undefined) {
            onActivate(id);
        }
    };

    return (
        <View className={className} role="navigation" aria-label="Primary">
            <View className="menu__group menu__group--root" role="list">
                {tree.map((node) => (
                    <MenuNodeView
                        key={node.item.id}
                        node={node}
                        onSelect={handleSelect}
                        depth={0}
                    />
                ))}
            </View>
        </View>
    );
}

function findItem(nodes: MenuNode[], id: string): MenuNode["item"] | null {
    for (const node of nodes) {
        if (node.item.id === id) {
            return node.item;
        }
        const found = findItem(node.children, id);
        if (found !== null) {
            return found;
        }
    }
    return null;
}
