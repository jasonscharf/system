import React, { useEffect, useState } from "react";
import type { ConversationEntity, InboxEntity } from "../types.js";
import { ConversationThread } from "./ConversationThread.js";

export interface InboxViewProps {
    inboxId: string;
    currentUserId: string;
    apiBase?: string;
}

export function InboxView({
    inboxId,
    currentUserId,
    apiBase = "",
}: InboxViewProps): React.ReactElement {
    const [inbox, setInbox] = useState<InboxEntity | null>(null);
    const [conversations, setConversations] = useState<ConversationEntity[]>([]);
    const [selected, setSelected] = useState<ConversationEntity | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        Promise.all([
            fetch(`${apiBase}/api/convos/inboxes/${inboxId}`, {
                credentials: "include",
            }).then((r) => r.json() as Promise<InboxEntity>),
            fetch(`${apiBase}/api/convos/inboxes/${inboxId}/conversations`, {
                credentials: "include",
            }).then((r) => r.json() as Promise<ConversationEntity[]>),
        ])
            .then(([inboxData, convosData]) => {
                setInbox(inboxData);
                setConversations(convosData);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [inboxId, apiBase]);

    if (loading) {
        return <div className="convos-inbox convos-inbox--loading">Loading inbox…</div>;
    }

    if (!inbox) {
        return <div className="convos-inbox convos-inbox--error">Inbox not found.</div>;
    }

    return (
        <div className="convos-inbox">
            <aside className="convos-inbox__sidebar">
                <h2 className="convos-inbox__name">{inbox.name}</h2>
                <ul className="convos-inbox__list">
                    {conversations.length === 0 && (
                        <li className="convos-inbox__empty">No conversations.</li>
                    )}
                    {conversations.map((c) => (
                        <li key={c.id} className="convos-inbox__item">
                            <button
                                type="button"
                                className={`convos-inbox__item-btn${selected?.id === c.id ? " convos-inbox__item-btn--active" : ""}`}
                                onClick={() => setSelected(c)}
                            >
                                <span className="convos-inbox__item-title">{c.title}</span>
                                <span
                                    className={`convos-inbox__item-status convos-inbox__item-status--${c.status}`}
                                >
                                    {c.status}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            </aside>

            <main className="convos-inbox__main">
                {selected ? (
                    <ConversationThread
                        conversation={selected}
                        currentUserId={currentUserId}
                        apiBase={apiBase}
                    />
                ) : (
                    <div className="convos-inbox__placeholder">
                        Select a conversation to view.
                    </div>
                )}
            </main>
        </div>
    );
}
