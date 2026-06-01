import type React from "react";
import { useState } from "react";
import type { ConversationEntity } from "../types.js";
import { MessageBubble } from "./MessageBubble.js";
import { MessageComposer } from "./MessageComposer.js";
import { useMessages } from "./useConversations.js";

export interface ConversationThreadProps {
    conversation: ConversationEntity;
    currentUserId: string;
    apiBase?: string;
}

export function ConversationThread({
    conversation,
    currentUserId,
    apiBase,
}: ConversationThreadProps): React.ReactElement {
    const { messages, loading, postMessage, editMessage, deleteMessage } = useMessages({
        conversationId: conversation.id,
        apiBase,
    });

    const [replyToId, setReplyToId] = useState<string | null>(null);
    const replyTarget = messages.find((m) => m.id === replyToId) ?? undefined;

    return (
        <div className="convos-thread">
            <div className="convos-thread__header">
                <h2 className="convos-thread__title">{conversation.title}</h2>
                <span
                    className={`convos-thread__status convos-thread__status--${conversation.status}`}
                >
                    {conversation.status}
                </span>
            </div>

            <div className="convos-thread__messages">
                {loading && <p className="convos-thread__loading">Loading…</p>}
                {!loading && messages.length === 0 && (
                    <p className="convos-thread__empty">No messages yet. Start the conversation.</p>
                )}
                {messages.map((msg) => (
                    <MessageBubble
                        key={msg.id}
                        message={msg}
                        currentUserId={currentUserId}
                        onEdit={(id, content) => void editMessage(id, content)}
                        onDelete={(id) => void deleteMessage(id)}
                        onReply={(id) => setReplyToId(id)}
                    />
                ))}
            </div>

            {conversation.status === "open" && (
                <MessageComposer
                    onSubmit={(content, rId) => void postMessage(content, rId)}
                    replyTo={replyTarget}
                    onCancelReply={() => setReplyToId(null)}
                    disabled={false}
                />
            )}
        </div>
    );
}
