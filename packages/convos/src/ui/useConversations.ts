import { useCallback, useEffect, useState } from "react";
import type { ConversationEntity, MessageEntity, NotificationEntity } from "../types.js";

export interface UseConversationsOpts {
    /** IRI of the business object to load conversations for. */
    subjectIri: string;
    userId: string;
    apiBase?: string;
}

export interface UseConversationsResult {
    conversations: ConversationEntity[];
    loading: boolean;
    error: string | null;
    createConversation: (
        title: string,
        initialMessage?: string,
    ) => Promise<ConversationEntity | null>;
    refresh: () => void;
}

export function useConversations(opts: UseConversationsOpts): UseConversationsResult {
    const { subjectIri, userId, apiBase = "" } = opts;
    const [conversations, setConversations] = useState<ConversationEntity[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);

    // biome-ignore lint/correctness/useExhaustiveDependencies: tick is a manual refresh counter; changing it triggers a re-fetch without being read inside the effect body
    useEffect(() => {
        setLoading(true);
        const url = `${apiBase}/api/convos/conversations?subjectIri=${encodeURIComponent(subjectIri)}`;
        fetch(url, { credentials: "include" })
            .then((r) => {
                if (!r.ok) {
                    throw new Error(`${r.status} ${r.statusText}`);
                }
                return r.json() as Promise<ConversationEntity[]>;
            })
            .then((data) => {
                setConversations(data);
                setError(null);
            })
            .catch((e: unknown) => {
                setError(e instanceof Error ? e.message : String(e));
            })
            .finally(() => {
                setLoading(false);
            });
    }, [subjectIri, apiBase, tick]);

    const createConversation = useCallback(
        async (title: string, initialMessage?: string): Promise<ConversationEntity | null> => {
            try {
                const r = await fetch(`${apiBase}/api/convos/conversations`, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ subjectIri, title, initialMessage, callerIri: userId }),
                });
                if (!r.ok) {
                    return null;
                }
                const created = (await r.json()) as { conversation: ConversationEntity };
                setTick((t) => t + 1);
                return created.conversation;
            } catch {
                return null;
            }
        },
        [subjectIri, userId, apiBase],
    );

    const refresh = useCallback(() => setTick((t) => t + 1), []);

    return { conversations, loading, error, createConversation, refresh };
}

export interface UseNotificationsOpts {
    userId: string;
    apiBase?: string;
    pollIntervalMs?: number;
}

export interface UseNotificationsResult {
    notifications: NotificationEntity[];
    unreadCount: number;
    loading: boolean;
    markRead: (notificationId: string) => Promise<void>;
    markAllRead: () => Promise<void>;
    dismiss: (notificationId: string) => Promise<void>;
}

export function useNotifications(opts: UseNotificationsOpts): UseNotificationsResult {
    const { userId, apiBase = "", pollIntervalMs = 30_000 } = opts;
    const [notifications, setNotifications] = useState<NotificationEntity[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(() => {
        fetch(`${apiBase}/api/convos/notifications?userId=${encodeURIComponent(userId)}`, {
            credentials: "include",
        })
            .then((r) => r.json() as Promise<NotificationEntity[]>)
            .then(setNotifications)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [userId, apiBase]);

    useEffect(() => {
        load();
        const id = setInterval(load, pollIntervalMs);
        return () => clearInterval(id);
    }, [load, pollIntervalMs]);

    const markRead = useCallback(
        async (notificationId: string): Promise<void> => {
            await fetch(`${apiBase}/api/convos/notifications/${notificationId}/read`, {
                method: "POST",
                credentials: "include",
            });
            setNotifications((prev) =>
                prev.map((n) => (n.id === notificationId ? { ...n, isRead: true } : n)),
            );
        },
        [apiBase],
    );

    const markAllRead = useCallback(async (): Promise<void> => {
        await fetch(`${apiBase}/api/convos/notifications/read-all`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId }),
        });
        setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    }, [userId, apiBase]);

    const dismiss = useCallback(
        async (notificationId: string): Promise<void> => {
            await fetch(`${apiBase}/api/convos/notifications/${notificationId}/dismiss`, {
                method: "POST",
                credentials: "include",
            });
            setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
        },
        [apiBase],
    );

    const unreadCount = notifications.filter((n) => !n.isRead && !n.isDismissed).length;

    return { notifications, unreadCount, loading, markRead, markAllRead, dismiss };
}

export interface UseMessagesOpts {
    conversationId: string;
    apiBase?: string;
}

export interface UseMessagesResult {
    messages: MessageEntity[];
    loading: boolean;
    postMessage: (content: string, replyToId?: string) => Promise<void>;
    editMessage: (messageId: string, content: string) => Promise<void>;
    deleteMessage: (messageId: string) => Promise<void>;
    refresh: () => void;
}

export function useMessages(opts: UseMessagesOpts): UseMessagesResult {
    const { conversationId, apiBase = "" } = opts;
    const [messages, setMessages] = useState<MessageEntity[]>([]);
    const [loading, setLoading] = useState(true);
    const [tick, setTick] = useState(0);

    // biome-ignore lint/correctness/useExhaustiveDependencies: tick is a manual refresh counter; changing it triggers a re-fetch without being read inside the effect body
    useEffect(() => {
        setLoading(true);
        fetch(`${apiBase}/api/convos/conversations/${conversationId}/messages`, {
            credentials: "include",
        })
            .then((r) => r.json() as Promise<MessageEntity[]>)
            .then(setMessages)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [conversationId, apiBase, tick]);

    const postMessage = useCallback(
        async (content: string, replyToId?: string): Promise<void> => {
            await fetch(`${apiBase}/api/convos/conversations/${conversationId}/messages`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content, replyToId }),
            });
            setTick((t) => t + 1);
        },
        [conversationId, apiBase],
    );

    const editMessage = useCallback(
        async (messageId: string, content: string): Promise<void> => {
            await fetch(`${apiBase}/api/convos/messages/${messageId}`, {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content }),
            });
            setTick((t) => t + 1);
        },
        [apiBase],
    );

    const deleteMessage = useCallback(
        async (messageId: string): Promise<void> => {
            await fetch(`${apiBase}/api/convos/messages/${messageId}`, {
                method: "DELETE",
                credentials: "include",
            });
            setTick((t) => t + 1);
        },
        [apiBase],
    );

    const refresh = useCallback(() => setTick((t) => t + 1), []);

    return { messages, loading, postMessage, editMessage, deleteMessage, refresh };
}
