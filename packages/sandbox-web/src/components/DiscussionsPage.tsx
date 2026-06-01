import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationEntity, MessageEntity } from "@jasonscharf/convos";

// ── config ────────────────────────────────────────────────────────────────────

const API_BASE = "/api/convos";
// The sandbox forum is a well-known subject IRI. Any IRI works here.
const FORUM_IRI = "http://tern.dev/sandbox/forum";
const ANON_IRI = "http://tern.dev/sandbox/user/anon";

// ── types ─────────────────────────────────────────────────────────────────────

interface ThreadViewProps {
    conversation: ConversationEntity;
    onBack: () => void;
}

// ── ThreadView ────────────────────────────────────────────────────────────────

function ThreadView({ conversation, onBack }: ThreadViewProps): React.ReactElement {
    const [messages, setMessages] = useState<MessageEntity[]>([]);
    const [loading, setLoading] = useState(true);
    const [content, setContent] = useState("");
    const [replyTo, setReplyTo] = useState<MessageEntity | null>(null);
    const [posting, setPosting] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);

    const loadMessages = useCallback(async () => {
        const r = await fetch(`${API_BASE}/conversations/${conversation.id}/messages`, {
            credentials: "include",
        });
        if (r.ok) {
            setMessages(await r.json() as MessageEntity[]);
        }
        setLoading(false);
    }, [conversation.id]);

    useEffect(() => {
        void loadMessages();
    }, [loadMessages]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    async function markRead(lastId: string): Promise<void> {
        await fetch(`${API_BASE}/conversations/${conversation.id}/read`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: ANON_IRI, lastReadMessageId: lastId }),
        });
    }

    async function handlePost(e: React.FormEvent): Promise<void> {
        e.preventDefault();
        const trimmed = content.trim();
        if (!trimmed || posting) {
            return;
        }
        setPosting(true);
        try {
            await fetch(`${API_BASE}/conversations/${conversation.id}/messages`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content: trimmed,
                    callerIri: ANON_IRI,
                    replyToId: replyTo?.id,
                }),
            });
            setContent("");
            setReplyTo(null);
            await loadMessages();
            const msgs = await fetch(
                `${API_BASE}/conversations/${conversation.id}/messages`,
                { credentials: "include" },
            ).then((r) => r.json() as Promise<MessageEntity[]>);
            if (msgs.length > 0) {
                await markRead(msgs[msgs.length - 1].id);
            }
        } finally {
            setPosting(false);
        }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            void handlePost(e as unknown as React.FormEvent);
        }
    }

    return (
        <div className="disc-thread">
            <div className="disc-thread__header">
                <button type="button" className="disc-back-btn" onClick={onBack}>
                    ← Back
                </button>
                <div className="disc-thread__meta">
                    <h2 className="disc-thread__title">{conversation.title}</h2>
                    <span className={`disc-badge disc-badge--${conversation.status}`}>
                        {conversation.status}
                    </span>
                </div>
            </div>

            <div className="disc-thread__messages">
                {loading && <p className="disc-empty">Loading…</p>}
                {!loading && messages.length === 0 && (
                    <p className="disc-empty">No replies yet. Start the discussion below.</p>
                )}
                {messages.map((msg) => (
                    <div
                        key={msg.id}
                        className={`disc-msg${msg.isDeleted ? " disc-msg--deleted" : ""}`}
                    >
                        {msg.replyToId && (
                            <div className="disc-msg__reply-indicator">
                                ↩ reply to an earlier message
                            </div>
                        )}
                        <div className="disc-msg__author">
                            {msg.authorId.split("/").pop()}
                            {msg.revisionCount > 0 && (
                                <span className="disc-msg__edited"> (edited)</span>
                            )}
                        </div>
                        <div className="disc-msg__content">
                            {msg.isDeleted ? "(deleted)" : msg.content}
                        </div>
                        <div className="disc-msg__meta">
                            <span className="disc-msg__time">
                                {new Date(msg.createdAt).toLocaleString()}
                            </span>
                            {!msg.isDeleted && conversation.status === "open" && (
                                <button
                                    type="button"
                                    className="disc-msg__reply-btn"
                                    onClick={() => setReplyTo(msg)}
                                >
                                    Reply
                                </button>
                            )}
                        </div>
                    </div>
                ))}
                <div ref={bottomRef} />
            </div>

            {conversation.status === "open" && (
                <form className="disc-composer" onSubmit={(e) => void handlePost(e)}>
                    {replyTo && (
                        <div className="disc-composer__reply-banner">
                            <span>
                                Replying to{" "}
                                <strong>{replyTo.authorId.split("/").pop()}</strong>:&nbsp;
                                {replyTo.content.slice(0, 60)}
                            </span>
                            <button
                                type="button"
                                className="disc-composer__cancel-reply"
                                onClick={() => setReplyTo(null)}
                            >
                                ✕
                            </button>
                        </div>
                    )}
                    <textarea
                        className="disc-composer__textarea"
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Write a reply… (Ctrl+Enter to post)"
                        rows={3}
                        disabled={posting}
                    />
                    <div className="disc-composer__footer">
                        <button
                            type="submit"
                            className="disc-composer__submit"
                            disabled={posting || !content.trim()}
                        >
                            {posting ? "Posting…" : "Post Reply"}
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
}

// ── DiscussionsPage ───────────────────────────────────────────────────────────

export function DiscussionsPage(): React.ReactElement {
    const [conversations, setConversations] = useState<ConversationEntity[]>([]);
    const [selected, setSelected] = useState<ConversationEntity | null>(null);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [newTitle, setNewTitle] = useState("");
    const [newMessage, setNewMessage] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const loadConvos = useCallback(async () => {
        setLoading(true);
        try {
            const r = await fetch(
                `${API_BASE}/conversations?subjectIri=${encodeURIComponent(FORUM_IRI)}`,
                { credentials: "include" },
            );
            if (r.ok) {
                setConversations(await r.json() as ConversationEntity[]);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadConvos();
    }, [loadConvos]);

    async function handleCreate(e: React.FormEvent): Promise<void> {
        e.preventDefault();
        if (!newTitle.trim() || submitting) {
            return;
        }
        setSubmitting(true);
        try {
            await fetch(`${API_BASE}/conversations`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    subjectIri: FORUM_IRI,
                    title: newTitle.trim(),
                    initialMessage: newMessage.trim() || undefined,
                    callerIri: ANON_IRI,
                }),
            });
            setNewTitle("");
            setNewMessage("");
            setCreating(false);
            await loadConvos();
        } finally {
            setSubmitting(false);
        }
    }

    if (selected) {
        return (
            <ThreadView
                conversation={selected}
                onBack={() => {
                    setSelected(null);
                    void loadConvos();
                }}
            />
        );
    }

    return (
        <div className="disc-page">
            <div className="disc-page__header">
                <h1 className="disc-page__title">Discussions</h1>
                <p className="disc-page__subtitle">
                    Forum threads attached to{" "}
                    <code className="disc-code">{FORUM_IRI}</code>. Any business
                    object can have conversations — this is just the sandbox forum.
                </p>
            </div>

            <div className="disc-page__toolbar">
                <button
                    type="button"
                    className="disc-btn disc-btn--primary"
                    onClick={() => setCreating((v) => !v)}
                >
                    {creating ? "Cancel" : "+ New Thread"}
                </button>
            </div>

            {creating && (
                <form
                    className="disc-new-form"
                    onSubmit={(e) => void handleCreate(e)}
                >
                    <input
                        className="disc-input"
                        type="text"
                        placeholder="Thread title"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        required
                        autoFocus
                    />
                    <textarea
                        className="disc-textarea"
                        placeholder="Opening message (optional)"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        rows={3}
                    />
                    <div className="disc-new-form__actions">
                        <button
                            type="submit"
                            className="disc-btn disc-btn--primary"
                            disabled={submitting || !newTitle.trim()}
                        >
                            {submitting ? "Creating…" : "Create Thread"}
                        </button>
                    </div>
                </form>
            )}

            {loading && <p className="disc-empty">Loading threads…</p>}

            {!loading && conversations.length === 0 && !creating && (
                <p className="disc-empty">No threads yet. Start one above.</p>
            )}

            <ul className="disc-thread-list">
                {conversations.map((c) => (
                    <li key={c.id} className="disc-thread-item">
                        <button
                            type="button"
                            className="disc-thread-item__btn"
                            onClick={() => setSelected(c)}
                        >
                            <div className="disc-thread-item__top">
                                <span className="disc-thread-item__title">{c.title}</span>
                                <span className={`disc-badge disc-badge--${c.status}`}>
                                    {c.status}
                                </span>
                            </div>
                            <div className="disc-thread-item__meta">
                                <span className="disc-thread-item__author">
                                    {c.createdBy.split("/").pop()}
                                </span>
                                <span className="disc-thread-item__time">
                                    {new Date(c.createdAt).toLocaleDateString()}
                                </span>
                            </div>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}
