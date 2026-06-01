import React, { useRef, useState } from "react";
import { useNotifications } from "./useConversations.js";

export interface NotificationBadgeProps {
    userId: string;
    apiBase?: string;
    pollIntervalMs?: number;
}

export function NotificationBadge({
    userId,
    apiBase,
    pollIntervalMs,
}: NotificationBadgeProps): React.ReactElement {
    const { notifications, unreadCount, markRead, markAllRead, dismiss } = useNotifications({
        userId,
        apiBase,
        pollIntervalMs,
    });

    const [open, setOpen] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    return (
        <div className="convos-notif-badge">
            <button
                type="button"
                className="convos-notif-badge__trigger"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
            >
                <span className="convos-notif-badge__icon">🔔</span>
                {unreadCount > 0 && (
                    <span className="convos-notif-badge__count">{unreadCount}</span>
                )}
            </button>

            {open && (
                <div className="convos-notif-panel" ref={panelRef}>
                    <div className="convos-notif-panel__header">
                        <span className="convos-notif-panel__title">Notifications</span>
                        {unreadCount > 0 && (
                            <button
                                type="button"
                                className="convos-notif-panel__read-all"
                                onClick={() => void markAllRead()}
                            >
                                Mark all read
                            </button>
                        )}
                    </div>

                    {notifications.length === 0 && (
                        <p className="convos-notif-panel__empty">No notifications.</p>
                    )}

                    <ul className="convos-notif-panel__list">
                        {notifications.map((n) => (
                            <li
                                key={n.id}
                                className={`convos-notif-panel__item${n.isRead ? " convos-notif-panel__item--read" : ""}`}
                            >
                                <div className="convos-notif-panel__item-body">
                                    <span className="convos-notif-panel__item-type">
                                        {n.notifType}
                                    </span>
                                    <span className="convos-notif-panel__item-time">
                                        {new Date(n.createdAt).toLocaleString()}
                                    </span>
                                </div>
                                <div className="convos-notif-panel__item-actions">
                                    {!n.isRead && (
                                        <button
                                            type="button"
                                            className="convos-notif-panel__mark-read"
                                            onClick={() => void markRead(n.id)}
                                        >
                                            Mark read
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        className="convos-notif-panel__dismiss"
                                        onClick={() => void dismiss(n.id)}
                                    >
                                        Dismiss
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
