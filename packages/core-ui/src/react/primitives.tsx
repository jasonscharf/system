import React from "react";
import { Platform, Pressable, Text, View } from "react-native";

// ── Shared prop interfaces ──────────────────────────────────────────────────

export interface PrimitiveProps {
    readonly className?: string;
    readonly id?: string;
    readonly role?: string;
    readonly children?: React.ReactNode;
    /** Maps to `data-testid` on web and `testID` on native. */
    readonly testID?: string;
    /** Each entry becomes a `data-<key>` attribute on web, `dataSet` on native. */
    readonly data?: Readonly<Record<string, string | number | boolean>>;
    readonly "aria-label"?: string;
    readonly "aria-hidden"?: boolean;
}

export interface ButtonProps extends PrimitiveProps {
    readonly onClick?: () => void;
    readonly disabled?: boolean;
    /** Defaults to "button" to prevent accidental form submission. */
    readonly type?: "button" | "submit" | "reset";
}

// ── Internal helpers ────────────────────────────────────────────────────────

function dataAttrs(
    data?: Readonly<Record<string, string | number | boolean>>,
): Record<string, string> {
    if (data === undefined) {
        return {};
    }
    return Object.fromEntries(Object.entries(data).map(([k, v]) => [`data-${k}`, String(v)]));
}

/**
 * Build a DOM element using React.createElement so we can freely spread
 * data-* attributes without fighting the JSX type checker.
 */
function webEl(
    tag: string,
    props: PrimitiveProps,
    extra?: Record<string, unknown>,
): React.ReactElement {
    const {
        className,
        id,
        role,
        children,
        testID,
        data,
        "aria-label": ariaLabel,
        "aria-hidden": ariaHidden,
    } = props;
    return React.createElement(
        tag,
        {
            ...(className !== undefined ? { className } : {}),
            ...(id !== undefined ? { id } : {}),
            ...(role !== undefined ? { role } : {}),
            ...(ariaLabel !== undefined ? { "aria-label": ariaLabel } : {}),
            ...(ariaHidden !== undefined ? { "aria-hidden": ariaHidden } : {}),
            ...(testID !== undefined ? { "data-testid": testID } : {}),
            ...dataAttrs(data),
            ...extra,
        },
        children,
    );
}

// Native fallback: a View carrying role + testID + dataSet.
function nativeView(props: PrimitiveProps): React.ReactElement {
    return (
        <View
            role={props.role}
            testID={props.testID}
            aria-label={props["aria-label"]}
            dataSet={props.data}
        >
            {props.children}
        </View>
    );
}

// Native fallback: a Text node.
function nativeText(props: PrimitiveProps): React.ReactElement {
    return (
        <Text role={props.role} testID={props.testID} aria-label={props["aria-label"]}>
            {props.children}
        </Text>
    );
}

// ── Block / container primitives (native → View) ───────────────────────────

export function Div(props: PrimitiveProps): React.ReactElement {
    if (Platform.OS === "web") {
        return webEl("div", props);
    }
    return nativeView(props);
}

export function Nav(props: PrimitiveProps): React.ReactElement {
    if (Platform.OS === "web") {
        return webEl("nav", props);
    }
    return nativeView({ role: "navigation", ...props });
}

export function Header(props: PrimitiveProps): React.ReactElement {
    if (Platform.OS === "web") {
        return webEl("header", props);
    }
    return nativeView({ role: "banner", ...props });
}

export function Footer(props: PrimitiveProps): React.ReactElement {
    if (Platform.OS === "web") {
        return webEl("footer", props);
    }
    return nativeView({ role: "contentinfo", ...props });
}

export function Aside(props: PrimitiveProps): React.ReactElement {
    if (Platform.OS === "web") {
        return webEl("aside", props);
    }
    return nativeView({ role: "complementary", ...props });
}

export function Main(props: PrimitiveProps): React.ReactElement {
    if (Platform.OS === "web") {
        return webEl("main", props);
    }
    return nativeView({ role: "main", ...props });
}

export function Section(props: PrimitiveProps): React.ReactElement {
    if (Platform.OS === "web") {
        return webEl("section", props);
    }
    return nativeView({ role: "region", ...props });
}

export function Ul(props: PrimitiveProps): React.ReactElement {
    if (Platform.OS === "web") {
        return webEl("ul", props);
    }
    return nativeView(props);
}

export function Ol(props: PrimitiveProps): React.ReactElement {
    if (Platform.OS === "web") {
        return webEl("ol", props);
    }
    return nativeView(props);
}

export function Li(props: PrimitiveProps): React.ReactElement {
    if (Platform.OS === "web") {
        return webEl("li", props);
    }
    return nativeView(props);
}

export function Hr(props: Omit<PrimitiveProps, "children">): React.ReactElement {
    if (Platform.OS === "web") {
        return webEl("hr", props as PrimitiveProps);
    }
    return nativeView(props as PrimitiveProps);
}

// ── Text / inline primitives (native → Text) ──────────────────────────────

export function Span(props: PrimitiveProps): React.ReactElement {
    if (Platform.OS === "web") {
        return webEl("span", props);
    }
    return nativeText(props);
}

export function P(props: PrimitiveProps): React.ReactElement {
    if (Platform.OS === "web") {
        return webEl("p", props);
    }
    return nativeText(props);
}

export function H1(props: PrimitiveProps): React.ReactElement {
    if (Platform.OS === "web") {
        return webEl("h1", props);
    }
    return nativeText({ role: "heading", ...props });
}

export function H2(props: PrimitiveProps): React.ReactElement {
    if (Platform.OS === "web") {
        return webEl("h2", props);
    }
    return nativeText({ role: "heading", ...props });
}

export function H3(props: PrimitiveProps): React.ReactElement {
    if (Platform.OS === "web") {
        return webEl("h3", props);
    }
    return nativeText({ role: "heading", ...props });
}

export function H4(props: PrimitiveProps): React.ReactElement {
    if (Platform.OS === "web") {
        return webEl("h4", props);
    }
    return nativeText({ role: "heading", ...props });
}

export function H5(props: PrimitiveProps): React.ReactElement {
    if (Platform.OS === "web") {
        return webEl("h5", props);
    }
    return nativeText({ role: "heading", ...props });
}

export function H6(props: PrimitiveProps): React.ReactElement {
    if (Platform.OS === "web") {
        return webEl("h6", props);
    }
    return nativeText({ role: "heading", ...props });
}

// ── Interactive primitive (native → Pressable) ────────────────────────────

export function Button(props: ButtonProps): React.ReactElement {
    const { onClick, disabled, type = "button", ...base } = props;
    if (Platform.OS === "web") {
        return webEl("button", base, { onClick, disabled, type });
    }
    return (
        <Pressable
            role="button"
            onPress={onClick}
            testID={base.testID}
            aria-label={base["aria-label"]}
            dataSet={base.data}
        >
            {base.children}
        </Pressable>
    );
}
