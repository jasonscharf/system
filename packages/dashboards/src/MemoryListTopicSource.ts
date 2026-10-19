import {
    type ListQuery,
    type ListRow,
    type ListSchema,
    listWindowFrame,
    planListPush,
} from "@terncosoftware/core/list";
import type {
    ListTopicHandle,
    ListTopicListener,
    ListTopicSource,
    ListTopicSubscription,
} from "./ListTopicView.js";

interface OpenView {
    query: ListQuery;
    readonly listener: ListTopicListener;
}

/**
 * A list topic served from rows held in memory, pushing through the same
 * placement rule a server uses. For tests, previews and hosts whose data
 * already sits in the browser.
 */
export class MemoryListTopicSource<T extends ListRow = ListRow> implements ListTopicSource {
    private _rows: readonly T[];
    private readonly _views = new Set<OpenView>();

    constructor(
        private readonly _topic: string,
        private readonly _schema: ListSchema,
        rows: readonly T[] = [],
    ) {
        this._rows = rows;
    }

    open(subscription: ListTopicSubscription, listener: ListTopicListener): ListTopicHandle {
        if (subscription.topic !== this._topic) {
            listener.error(`Unknown topic: ${subscription.topic}`);
            return { update: () => {}, close: () => {} };
        }
        const view: OpenView = { query: subscription.query, listener };
        this._views.add(view);
        listener.frame(listWindowFrame(this._rows, view.query, this._schema));
        return {
            update: (query) => {
                view.query = query;
                listener.frame(listWindowFrame(this._rows, query, this._schema));
            },
            close: () => {
                this._views.delete(view);
            },
        };
    }

    rows(): readonly T[] {
        return this._rows;
    }

    /** Replace the rows and push each open view whatever it can see change. */
    set(rows: readonly T[]): void {
        const before = this._rows;
        this._rows = rows;
        for (const view of this._views) {
            const frame = planListPush(before, rows, view.query, this._schema);
            if (frame !== null) {
                view.listener.frame(frame);
            }
        }
    }

    /** How many views are open. */
    openViews(): number {
        return this._views.size;
    }
}
