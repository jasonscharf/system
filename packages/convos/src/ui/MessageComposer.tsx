import type React from "react";
import { useRef, useState } from "react";
import type { MessageEntity } from "../types.js";

export interface MessageComposerProps {
    onSubmit: (content: string, replyToId?: string) => Promise<void> | void;
    replyTo?: MessageEntity;
    onCancelReply?: () => void;
    placeholder?: string;
    disabled?: boolean;
}

export function MessageComposer({
    onSubmit,
    replyTo,
    onCancelReply,
    placeholder = "Write a message…",
    disabled = false,
}: MessageComposerProps): React.ReactElement {
    const [content, setContent] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    async function handleSubmit(e: React.FormEvent): Promise<void> {
        e.preventDefault();
        const trimmed = content.trim();
        if (!trimmed || submitting) {
            return;
        }
        setSubmitting(true);
        try {
            await onSubmit(trimmed, replyTo?.id);
            setContent("");
            if (onCancelReply) {
                onCancelReply();
            }
        } finally {
            setSubmitting(false);
        }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            void handleSubmit(e as unknown as React.FormEvent);
        }
    }

    return (
        <form className="convos-composer" onSubmit={(e) => void handleSubmit(e)}>
            {replyTo && (
                <div className="convos-composer__reply-banner">
                    <span className="convos-composer__reply-label">
                        {`Replying to ${replyTo.authorId}`}
                    </span>
                    <span className="convos-composer__reply-preview">
                        {replyTo.content.slice(0, 80)}
                    </span>
                    {onCancelReply && (
                        <button
                            type="button"
                            className="convos-composer__reply-cancel"
                            onClick={onCancelReply}
                        >
                            ✕
                        </button>
                    )}
                </div>
            )}
            <textarea
                ref={textareaRef}
                className="convos-composer__textarea"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                disabled={disabled || submitting}
                rows={3}
            />
            <div className="convos-composer__footer">
                <span className="convos-composer__hint">Ctrl+Enter to send</span>
                <button
                    type="submit"
                    className="convos-composer__submit"
                    disabled={disabled || submitting || !content.trim()}
                >
                    {submitting ? "Sending…" : "Send"}
                </button>
            </div>
        </form>
    );
}
