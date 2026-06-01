import type React from "react";
import { useState } from "react";
import type { ConversationEntity } from "../types.js";
import { useConversations } from "./useConversations.js";

export interface ConversationListProps {
    /**
     * IRI of any business object — user, contract, deal, etc.
     * This is the only coupling point; ConversationList knows nothing about the object type.
     */
    subjectIri: string;
    currentUserId: string;
    apiBase?: string;
    onSelect?: (conversation: ConversationEntity) => void;
}

export function ConversationList({
    subjectIri,
    currentUserId,
    apiBase,
    onSelect,
}: ConversationListProps): React.ReactElement {
    const { conversations, loading, error, createConversation, refresh } = useConversations({
        subjectIri,
        userId: currentUserId,
        apiBase,
    });

    const [creating, setCreating] = useState(false);
    const [newTitle, setNewTitle] = useState("");
    const [newMessage, setNewMessage] = useState("");

    async function handleCreate(e: React.FormEvent): Promise<void> {
        e.preventDefault();
        if (!newTitle.trim()) {
            return;
        }
        await createConversation(newTitle.trim(), newMessage.trim() || undefined);
        setNewTitle("");
        setNewMessage("");
        setCreating(false);
        refresh();
    }

    return (
        <div className="convos-list">
            <div className="convos-list__toolbar">
                <h3 className="convos-list__heading">Conversations</h3>
                <button
                    type="button"
                    className="convos-list__new-btn"
                    onClick={() => setCreating((v) => !v)}
                >
                    + New
                </button>
            </div>

            {creating && (
                <form className="convos-list__new-form" onSubmit={(e) => void handleCreate(e)}>
                    <input
                        className="convos-list__new-title"
                        type="text"
                        placeholder="Conversation title"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        required
                    />
                    <textarea
                        className="convos-list__new-message"
                        placeholder="Optional first message"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        rows={2}
                    />
                    <div className="convos-list__new-actions">
                        <button type="submit" className="convos-list__new-submit">
                            Create
                        </button>
                        <button
                            type="button"
                            className="convos-list__new-cancel"
                            onClick={() => setCreating(false)}
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            )}

            {loading && <p className="convos-list__loading">Loading…</p>}
            {error && <p className="convos-list__error">{error}</p>}

            {!loading && conversations.length === 0 && !creating && (
                <p className="convos-list__empty">No conversations yet.</p>
            )}

            <ul className="convos-list__items">
                {conversations.map((c) => (
                    <li key={c.id} className="convos-list__item">
                        <button
                            type="button"
                            className="convos-list__item-btn"
                            onClick={() => onSelect?.(c)}
                        >
                            <span className="convos-list__item-title">{c.title}</span>
                            <span
                                className={`convos-list__item-status convos-list__item-status--${c.status}`}
                            >
                                {c.status}
                            </span>
                            {c.assignedTo && (
                                <span className="convos-list__item-assignee">{c.assignedTo}</span>
                            )}
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}
