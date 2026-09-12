import { useCallback, useEffect, useRef, useState } from "react";

import client from "../api/client.js";
import { useSocket } from "../context/SocketContext.jsx";
import { relativeTime } from "../utils/time.js";

const PAGE_SIZE = 20;

// Human-readable line per notification type. Falls back gracefully for rows
// written before a field existed (older new_message rows have no username).
export const describeNotification = (notification) => {
  const data = notification.data ?? {};
  const group = data.groupName ?? "a group";

  switch (notification.type) {
    case "new_message":
      return data.groupId
        ? `${data.senderUsername ?? "Someone"} posted in ${group}`
        : `${data.senderUsername ?? "Someone"} sent you a message`;
    case "added_to_group":
      return `You were added to ${group}`;
    case "promoted_to_admin":
      return `You were made an admin of ${group}`;
    case "group_renamed":
      return `${data.previousName ?? "A group"} was renamed to ${group}`;
    default:
      return "You have a new notification";
  }
};

// Which conversation a notification points at, or null if it isn't openable.
export const targetOfNotification = (notification) => {
  const data = notification.data ?? {};

  if (data.groupId) {
    return { type: "group", id: data.groupId, name: data.groupName ?? "Group" };
  }
  if (notification.type === "new_message" && data.senderId) {
    return {
      type: "direct",
      id: data.senderId,
      name: data.senderUsername ?? "Conversation",
    };
  }
  return null;
};

const BellIcon = () => (
  <svg className="bell-icon" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M10 2a5 5 0 0 0-5 5v3.2l-1.3 2.3a.7.7 0 0 0 .6 1h11.4a.7.7 0 0 0 .6-1L15 10.2V7a5 5 0 0 0-5-5z" />
    <path d="M8.2 15.2a1.9 1.9 0 0 0 3.6 0z" />
  </svg>
);

const NotificationBell = ({ onOpenTarget }) => {
  const { socket } = useSocket();

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const wrapRef = useRef(null);

  // Badge count on mount, without pulling the whole list.
  useEffect(() => {
    client
      .get("/notifications", { params: { limit: 1 } })
      .then(({ data }) => setUnreadCount(data.unreadCount ?? 0))
      .catch(() => {
        /* the bell is non-critical; stay silent until opened */
      });
  }, []);

  useEffect(() => {
    if (!socket) return undefined;

    const onNew = (notification) => {
      setUnreadCount((current) => current + 1);
      // Keep an open panel in sync too, without a refetch.
      setItems((current) =>
        current.some((n) => n.id === notification.id)
          ? current
          : [notification, ...current]
      );
    };

    socket.on("new_notification", onNew);
    return () => socket.off("new_notification", onNew);
  }, [socket]);

  // Click-away and Escape both close the panel.
  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Marks exactly the rows passed in, so a later page doesn't clear counts for
  // notifications the user never saw.
  const markRead = useCallback(async (rows) => {
    const unread = rows.filter((n) => !n.read);
    if (unread.length === 0) return;

    const results = await Promise.allSettled(
      unread.map((n) => client.patch(`/notifications/${n.id}/read`))
    );

    const markedIds = new Set(
      unread.filter((_, i) => results[i].status === "fulfilled").map((n) => n.id)
    );
    if (markedIds.size === 0) return;

    setItems((current) =>
      current.map((n) => (markedIds.has(n.id) ? { ...n, read: true } : n))
    );
    setUnreadCount((current) => Math.max(0, current - markedIds.size));
  }, []);

  const loadPage = useCallback(
    async (nextPage, { append }) => {
      setLoading(true);
      setError("");

      try {
        const { data } = await client.get("/notifications", {
          params: { page: nextPage, limit: PAGE_SIZE },
        });
        const rows = data.notifications ?? [];

        setItems((current) => (append ? [...current, ...rows] : rows));
        setUnreadCount(data.unreadCount ?? 0);
        setHasMore(Boolean(data.hasMore));
        setPage(nextPage);

        // Opening the panel marks what it shows as read.
        await markRead(rows);
      } catch (err) {
        setError(err?.response?.data?.message ?? "Could not load notifications.");
      } finally {
        setLoading(false);
      }
    },
    [markRead]
  );

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) loadPage(1, { append: false });
  };

  const handleMarkAll = async () => {
    try {
      await client.patch("/notifications/read-all");
      setItems((current) => current.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (err) {
      setError(err?.response?.data?.message ?? "Could not mark all as read.");
    }
  };

  const handleClick = (notification) => {
    const target = targetOfNotification(notification);
    markRead([notification]);
    setOpen(false);
    if (target) onOpenTarget?.(target);
  };

  return (
    <div className="bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className="bell-button"
        onClick={toggle}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="bell-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="bell-panel" role="menu">
          <div className="bell-panel-head">
            <strong>Notifications</strong>
            <button
              type="button"
              onClick={handleMarkAll}
              disabled={unreadCount === 0}
            >
              Mark all as read
            </button>
          </div>

          {error && <p className="auth-error">{error}</p>}
          {loading && items.length === 0 && (
            <p className="chat-placeholder">Loading…</p>
          )}
          {!loading && !error && items.length === 0 && (
            <p className="chat-placeholder">Nothing yet.</p>
          )}

          <ul className="bell-list">
            {items.map((notification) => {
              const openable = Boolean(targetOfNotification(notification));

              return (
                <li key={notification.id}>
                  <button
                    type="button"
                    className={
                      notification.read ? "bell-item" : "bell-item unread"
                    }
                    onClick={() => handleClick(notification)}
                    disabled={!openable}
                  >
                    <span className="bell-item-text">
                      {describeNotification(notification)}
                    </span>
                    <span className="bell-item-time">
                      {relativeTime(notification.createdAt)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {hasMore && (
            <button
              type="button"
              className="bell-more"
              onClick={() => loadPage(page + 1, { append: true })}
              disabled={loading}
            >
              {loading ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
