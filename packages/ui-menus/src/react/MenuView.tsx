import type { Dispatch } from "@jasonscharf/core-ui";
import { Button, Li, Nav, Span, Ul, useComposition, useRevision } from "@jasonscharf/core-ui/react";
import type React from "react";
import type { MenuItemConfig, MenuNode } from "../menu.js";
import { useMenus } from "./context.js";

export interface MenuViewProps {
    readonly className?: string;
    readonly slot?: string;
    readonly label?: string;
    readonly onActivate?: (id: string) => void;
}

interface MenuNodeViewProps {
    readonly node: MenuNode;
    readonly onSelect: (item: MenuItemConfig) => void;
    readonly depth: number;
}

function MenuNodeView(props: MenuNodeViewProps): React.ReactElement {
    const { node, onSelect, depth } = props;
    const hasChildren = node.children.length > 0;
    return (
        <Li data={{ "menu-item": node.item.id, depth }}>
            <Button
                className="nav-link"
                data={{ message: node.item.message ?? "", kind: node.item.kind ?? "" }}
                onClick={() => onSelect(node.item)}
            >
                <Span className="nav-label">{node.item.label}</Span>
            </Button>
            {hasChildren ? (
                <Ul className="nav-list">
                    {node.children.map((child) => (
                        <MenuNodeView
                            key={child.item.id}
                            node={child}
                            onSelect={onSelect}
                            depth={depth + 1}
                        />
                    ))}
                </Ul>
            ) : null}
        </Li>
    );
}

export function MenuView(props: MenuViewProps): React.ReactElement {
    const { className, slot, label = "Navigation", onActivate } = props;
    const menus = useMenus();
    const composition = useComposition();
    useRevision();

    const tree = menus.assemble(slot);

    const handleSelect = (item: MenuItemConfig): void => {
        activate(composition.dispatch, item);
        if (onActivate !== undefined) {
            onActivate(item.id);
        }
    };

    return (
        <Nav className={className} aria-label={label}>
            <Ul className="nav-list nav-list-root">
                {tree.map((node) => (
                    <MenuNodeView
                        key={node.item.id}
                        node={node}
                        onSelect={handleSelect}
                        depth={0}
                    />
                ))}
            </Ul>
        </Nav>
    );
}

/**
 * Route a menu item's configured dispatch message through the seam. A grouping
 * item (no message) is a no-op; an absent kind defaults to a command.
 */
function activate(dispatch: Dispatch, item: MenuItemConfig): void {
    const { kind, message, arg } = item;
    if (message === undefined || message === null) {
        return;
    }
    switch (kind) {
        case "event":
            dispatch.event(message, arg);
            break;
        case "query":
            void dispatch.query(message).exec(arg);
            break;
        case "operation":
            void dispatch.operation(message).exec(arg);
            break;
        default:
            void dispatch.command(message).exec(arg);
            break;
    }
}
