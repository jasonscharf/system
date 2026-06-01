import React, { useState } from "react";
import type { MessageEntity, MessageRevisionEntity } from "../types.js";

export interface MessageBubbleProps {
    message: MessageEntity;
    currentUserId: string;
    revisions?: MessageRevisionEntity[];
    onEdit?: (messageId: string, newContent: string) => void;
    onDelete?: (messageId: string) => void;
    onReply?: (messageId: string) => void;
}

export function MessageBubble({
    message,
    currentUserId,
    revisions,
    onEdit,
    onDelete,
    onReply,
}: MessageBubbleProps): React.ReactElement {
    const [editing, setEditing] = useState(false);
    const [editContent, setEditContent] = useState(message.content);
    const [showRevisions, setShowRevisions] = useState(false);

    const isOwn = message.authorId === currentUserId;

    function handleEditSubmit(e: React.FormEvent): void {
        e.preventDefault();
        if (onEdit && editContent.trim()) {
            onEdit(message.id, editContent.trim());
        }
        setEditing(false);
    }

    if (message.isDeleted) {
        return (
            <div className="convos-message convos-message--deleted">
                <span className="convos-message__deleted-text">This message was deleted.</span>
            </div>
        );
    }

    return (
        <div className={`convos-message${isOwn ? " convos-message--own" : ""}`}>
            <div className="convos-message__meta">
                <span className="convos-message__author">{message.authorId}</span>
                <span className="convos-message__time">
                    {message.createdAt instanceof Date
                        ? message.createdAt.toLocaleString()
                        : new Date(message.createdAt).toLocaleString()}
                </span>
                {message.revisionCount > 0 && (
                    <button
                        className="convos-message__edited-badge"
                        onClick={() => setShowRevisions((v) => !v)}
                        type="button"
                    >
                        edited
                    </button>
                )}
            </div>

            {editing ? (
                <form className="convos-message__edit-form" onSubmit={handleEditSubmit}>
                    <textarea
                        className="convos-message__edit-textarea"
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={3}
                    />
                    <div className="convos-message__edit-actions">
                        <button type="submit" className="convos-message__edit-save">
                            Save
                        </button>
                        <button
                            type="button"
                            className="convos-message__edit-cancel"
                            onClick={() => {
                                setEditing(false);
                                setEditContent(message.content);
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            ) : (
                <div className="convos-message__content">{message.content}</div>
            )}

            {showRevisions && revisions && revisions.length > 0 && (
                <div className="convos-message__revisions">
                    <p className="convos-message__revisions-label">Edit history</p>
                    {revisions.map((rev) => (
                        <div key={rev.id} className="convos-message__revision">
                            <span className="convos-message__revision-content">{rev.content}</span>
                            <span className="convos-message__revision-meta">
                                {`v${rev.revision} — ${new Date(rev.editedAt).toLocaleString()}`}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            <div className="convos-message__actions">
                {onReply && (
                    <button
                        type="button"
                        className="convos-message__action"
                        onClick={() => onReply(message.id)}
                    >
                        Reply
                    </button>
                )}
                {isOwn && onEdit && !editing && (
                    <button
                        type="button"
                        className="convos-message__action"
                        onClick={() => setEditing(true)}
                    >
                        Edit
                    </button>
                )}
                {isOwn && onDelete && (
                    <button
                        type="button"
                        className="convos-message__action convos-message__action--danger"
                        onClick={() => onDelete(message.id)}
                    >
                        Delete
                    </button>
                )}
            </div>
        </div>
    );
}
