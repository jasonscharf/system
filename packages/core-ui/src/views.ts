import type { Dispatch } from "./dispatch.js";

/**
 * The context handed to every view-model factory at bind time. It carries the
 * dispatch seam (for commands/events) plus the serializable params the view was
 * contributed with. Deliberately small so view-models stay platform-agnostic.
 */
export interface ViewModelContext<TParams = Record<string, unknown>> {
    readonly dispatch: Dispatch;
    readonly params: TParams;
}

/**
 * A view-model is the unit of behavior behind a view. It is produced by a
 * factory bound to a ViewModelContext, so it can issue commands, subscribe to
 * events, and expose state/handlers to the view. Shape is open: product
 * packages define their own view-model interfaces.
 */
export type ViewModel = Record<string, unknown>;

/**
 * Factory that builds a view-model from its bind-time context. Pure with
 * respect to wiring: it receives dispatch + params and returns the model.
 */
export type ViewModelFactory<
    TModel extends ViewModel = ViewModel,
    TParams = Record<string, unknown>,
> = (ctx: ViewModelContext<TParams>) => TModel;

/**
 * A contributed view definition. `render` is intentionally typed as a generic
 * renderer keyed off the bound model so core stays framework-agnostic; the
 * React layer narrows this to a component. `viewModel` binds the view to its
 * behavior. `params` are serializable inputs frozen at contribution time.
 */
export interface ViewDefinition<
    TModel extends ViewModel = ViewModel,
    TParams = Record<string, unknown>,
> {
    readonly id: string;
    readonly viewModel: ViewModelFactory<TModel, TParams>;
    readonly render: ViewRenderer<TModel>;
    readonly params?: TParams;
}

/**
 * A renderer takes a bound view-model and produces an opaque rendered unit.
 * Core does not know what `TOutput` is (it is React.ReactNode in the React
 * layer), which keeps this module free of any UI framework dependency.
 */
export type ViewRenderer<TModel extends ViewModel = ViewModel, TOutput = unknown> = (
    model: TModel,
) => TOutput;

/**
 * The result of binding a ViewDefinition: the live view-model plus a render
 * thunk that closes over it. This is what a region host actually mounts.
 */
export interface BoundView<TModel extends ViewModel = ViewModel, TOutput = unknown> {
    readonly id: string;
    readonly model: TModel;
    render(): TOutput;
}

/**
 * Bind a view definition to a dispatch seam, instantiating its view-model and
 * returning a BoundView ready to render. This is the view to view-model
 * binding step: it is the only place the factory runs.
 */
export function bindView<TModel extends ViewModel, TParams, TOutput>(
    definition: ViewDefinition<TModel, TParams>,
    dispatch: Dispatch,
): BoundView<TModel, TOutput> {
    const params = (definition.params ?? ({} as TParams)) as TParams;
    const model = definition.viewModel({ dispatch, params });
    const render = definition.render as ViewRenderer<TModel, TOutput>;
    return {
        id: definition.id,
        model,
        render: () => render(model),
    };
}
