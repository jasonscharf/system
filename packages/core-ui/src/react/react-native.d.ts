// Minimal, self-contained type surface for the react-native primitives the
// core-ui binding layer renders. At runtime `react-native` is aliased to
// react-native-web by the Vite and vitest configs; on web, RNW renders these
// primitives to DOM and passes `className` straight through, which is how
// core-ui keeps ALL styling in classic `.css` files (targeted by classname)
// rather than StyleSheet, inline style objects, or any CSS-in-JS.
//
// We declare this module locally rather than depend on `@types/react-native-web`
// because that package transitively pulls the full react-native global typings
// (which redeclare globals such as `URL`) into every package's global scope and
// breaks unrelated builds. This declaration is scoped to core-ui via the
// tsconfig `paths` mapping and covers only what the binding layer uses:
// View/Text/Pressable/ScrollView with className + accessibility props.
declare module "react-native" {
    import type { FunctionComponent, ReactNode } from "react";

    interface RnwBaseProps {
        readonly className?: string;
        readonly role?: string;
        readonly testID?: string;
        readonly dataSet?: Record<string, string | number | boolean>;
        readonly "aria-label"?: string;
        readonly "aria-hidden"?: boolean;
        readonly children?: ReactNode;
    }

    export interface ViewProps extends RnwBaseProps {}
    export interface TextProps extends RnwBaseProps {}
    export interface ScrollViewProps extends RnwBaseProps {}
    export interface PressableProps extends RnwBaseProps {
        readonly onPress?: () => void;
    }

    export const View: FunctionComponent<ViewProps>;
    export const Text: FunctionComponent<TextProps>;
    export const ScrollView: FunctionComponent<ScrollViewProps>;
    export const Pressable: FunctionComponent<PressableProps>;

    /**
     * Platform detection. On web (react-native-web) OS is always "web".
     * The platform branch not taken is dead-code-eliminated by the bundler.
     */
    export const Platform: {
        readonly OS: "web" | "ios" | "android" | "windows" | "macos";
    };
}
