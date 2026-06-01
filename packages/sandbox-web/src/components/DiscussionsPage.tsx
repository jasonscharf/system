import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationEntity, MessageEntity } from "@jasonscharf/convos";

// ── config ────────────────────────────────────────────────────────────────────

const API_BASE = "/api/convos";
const FORUM_IRI = "http://tern.dev/sandbox/forum";
const AUTH_URL = "/auth/google";

// ── me ────────────────────────────────────────────────────────────────────────

interface MeInfo {
    iri: string;
    authenticated: boolean;
    email?: string;
    displayName?: string;
}

function useMe(): { me: MeInfo | null; loading: boolean } {
    const [me, setMe] = useState<MeInfo | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`${API_BASE}/me`, { credentials: "include" })
            .then((r) => (r.ok ? (r.json() as Promise<MeInfo>) : null))
            .then((data) => setMe(data))
            .catch(() => setMe(null))
            .finally(() => setLoading(false));
    }, []);

    return { me, loading };
}

// ── LoginGate ─────────────────────────────────────────────────────────────────

function LoginGate(): React.ReactElement {
    return (
        <div className="disc-page">
            <div className="disc-page__header">
                <h1 className="disc-page__title">Discussions</h1>
            </div>
            <div className="disc-login-gate">
                <p className="disc-login-gate__msg">
                    You need to sign in to participate in discussions.
                </p>
                <a className="disc-btn disc-btn--primary" href={AUTH_URL}>
                    Sign in with Google
                </a>
            </div>
        </div>
    );
}

// ── ThreadView ────────────────────────────────────────────────────────────────

interface ThreadViewProps {
    conversation: ConversationEntity;
    me: MeInfo;
    onBack: () => void;
}

function ThreadView({ conversation, me, onBack }: ThreadViewProps): React.ReactElement {
    const [messages, setMessages] = useState<MessageEntity[]>([]);
    const [loading, setLoading] = useState(true);
    const [content, setContent] = useState("");
    const [replyTo, setReplyTo] = useState<MessageEntity | null>(null);
    const [posting, setPosting] = useState(false);
    const [error, setError] = useState<string | null>(null);
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
            body: JSON.stringify({ userId: me.iri, lastReadMessageId: lastId }),
        });
    }

    async function handlePost(e: React.FormEvent): Promise<void> {
        e.preventDefault();
        const trimmed = content.trim();
        if (!trimmed || posting) {
            return;
        }
        setError(null);
        setPosting(true);
        try {
            const r = await fetch(`${API_BASE}/conversations/${conversation.id}/messages`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content: trimmed,
                    replyToId: replyTo?.id,
                }),
            });
            if (r.status === 403) {
                setError("You don't have permission to post here.");
                return;
            }
            if (!r.ok) {
                setError("Failed to post message.");
                return;
            }
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
                <span className="disc-thread__actor">
                    {me.displayName ?? me.email ?? me.iri.split("/").pop()}
                </span>
            </div>

            <div className="disc-thread__messages">
                {loading && <p className="disc-empty">Loading…</p>}
                {!loading && messages.length === 0 && (
                    <p className="disc-empty">No replies yet. Start the discussion below.</p>
                )}
                {messages.map((msg) => (
                    <div
                        key={msg.id}
                        className={`disc-msg${msg.isDeleted ? " disc-msg--deleted" : ""}${msg.authorId === me.iri ? " disc-msg--own" : ""}`}
                    >
                        {msg.replyToId && (
                            <div className="disc-msg__reply-indicator">
                                ↩ reply to an earlier message
                            </div>
                        )}
                        <div className="disc-msg__author">
                            {msg.authorId === me.iri ? "You" : msg.authorId.split("/").pop()}
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
                                <strong>
                                    {replyTo.authorId === me.iri
                                        ? "yourself"
                                        : replyTo.authorId.split("/").pop()}
                                </strong>
                                :&nbsp;
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
                    {error && <p className="disc-error">{error}</p>}
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
    const { me, loading: meLoading } = useMe();

    const [conversations, setConversations] = useState<ConversationEntity[]>([]);
    const [selected, setSelected] = useState<ConversationEntity | null>(null);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [newTitle, setNewTitle] = useState("");
    const [newMessage, setNewMessage] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

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
        if (me?.authenticated) {
            void loadConvos();
        }
    }, [me, loadConvos]);

    if (meLoading) {
        return <div className="disc-page"><p className="disc-empty">Loading…</p></div>;
    }

    if (!me?.authenticated) {
        return <LoginGate />;
    }

    if (selected) {
        return (
            <ThreadView
                conversation={selected}
                me={me}
                onBack={() => {
                    setSelected(null);
                    void loadConvos();
                }}
            />
        );
    }

    async function handleCreate(e: React.FormEvent): Promise<void> {
        e.preventDefault();
        if (!newTitle.trim() || submitting) {
            return;
        }
        setCreateError(null);
        setSubmitting(true);
        try {
            const r = await fetch(`${API_BASE}/conversations`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    subjectIri: FORUM_IRI,
                    title: newTitle.trim(),
                    initialMessage: newMessage.trim() || undefined,
                }),
            });
            if (r.status === 403) {
                setCreateError("You don't have permission to create threads.");
                return;
            }
            if (!r.ok) {
                setCreateError("Failed to create thread.");
                return;
            }
            setNewTitle("");
            setNewMessage("");
            setCreating(false);
            await loadConvos();
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="disc-page">
            <div className="disc-page__header">
                <div className="disc-page__header-top">
                    <h1 className="disc-page__title">Discussions</h1>
                    <span className="disc-page__user">
                        {me.displayName ?? me.email ?? me.iri.split("/").pop()}
                    </span>
                </div>
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
                    {createError && <p className="disc-error">{createError}</p>}
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
                                    {c.createdBy === me.iri
                                        ? "You"
                                        : c.createdBy.split("/").pop()}
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
