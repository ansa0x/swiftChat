import { useCallback, useEffect, useRef, useState } from "react";

import client from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useSocket } from "../context/SocketContext.jsx";
import ConversationList from "../components/ConversationList.jsx";
import NewGroupModal from "../components/NewGroupModal.jsx";
import GroupInfoPanel from "../components/GroupInfoPanel.jsx";
import Avatar from "../components/Avatar.jsx";
import ProfileModal from "../components/ProfileModal.jsx";
import NotificationBell from "../components/NotificationBell.jsx";

// How long after the last keystroke we tell peers typing has stopped.
const TYPING_IDLE_MS = 1200;
// Re-announce while the user keeps typing. Must be shorter than
// TYPING_EXPIRY_MS or the peer's indicator expires mid-sentence.
const TYPING_HEARTBEAT_MS = 2500;
// Safety net: drop a typer if their typing_stop never arrives.
const TYPING_EXPIRY_MS = 5000;

const formatTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const typingLabel = (names) => {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;

  const others = names.length - 2;
  return `${names[0]}, ${names[1]} and ${others} other${
    others === 1 ? "" : "s"
  } are typing…`;
};

const Chat = () => {
  const { user, logout, updateUser } = useAuth();
  const { socket, connected, onlineUsers } = useSocket();

  const [conversations, setConversations] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [conversationsError, setConversationsError] = useState("");

  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [threadError, setThreadError] = useState("");

  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState("");
  // userId -> { username, expiresAt }
  const [typers, setTypers] = useState({});

  const [pickerOpen, setPickerOpen] = useState(false);
  const [people, setPeople] = useState([]);
  const [peopleQuery, setPeopleQuery] = useState("");
  const [peopleError, setPeopleError] = useState("");

  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  // id -> { username, profilePhoto }, for naming and picturing group members.
  const [groupMembers, setGroupMembers] = useState({});
  const [notice, setNotice] = useState("");
  // Bumped to make the open GroupInfoPanel re-fetch after a live change.
  const [groupRefreshToken, setGroupRefreshToken] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);

  const selectedRef = useRef(null);
  const meRef = useRef(null);
  const conversationsRef = useRef([]);
  const groupMembersRef = useRef({});
  const typingIdleTimer = useRef(null);
  const isTypingRef = useRef(false);
  const lastTypingEmitRef = useRef(0);
  const bottomRef = useRef(null);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    meRef.current = user?.id ?? null;
  }, [user]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    groupMembersRef.current = groupMembers;
  }, [groupMembers]);

  const loadConversations = useCallback(
    () =>
      client
        .get("/conversations")
        .then(({ data }) => {
          const list = data.conversations ?? [];
          // A refetch can race a just-sent mark_read and come back with a
          // stale count. The open thread is read by definition, so pin it to 0.
          const open = selectedRef.current;
          setConversations(
            open
              ? list.map((entry) => {
                  const id = entry.type === "group" ? entry.group.id : entry.user.id;
                  const sameKind =
                    (entry.type === "group") === (open.type === "group");
                  return sameKind && id === open.id
                    ? { ...entry, unreadCount: 0 }
                    : entry;
                })
              : list
          );
          setConversationsError("");
        })
        .catch((error) => {
          setConversationsError(
            error?.response?.data?.message ?? "Could not load conversations."
          );
        }),
    []
  );

  useEffect(() => {
    loadConversations().finally(() => setLoadingConversations(false));
  }, [loadConversations]);

  // Declared above the effects that depend on it, or it is still in its
  // temporal dead zone when their dependency arrays are evaluated.
  const markThreadRead = useCallback(
    (target) => {
      if (!socket || !target) return;
      socket.emit(
        "mark_read",
        target.type === "group" ? { groupId: target.id } : { senderId: target.id }
      );
    },
    [socket]
  );

  // Message history for the open thread.
  useEffect(() => {
    if (!selected) {
      setMessages([]);
      return undefined;
    }

    let cancelled = false;
    setLoadingMessages(true);
    setThreadError("");

    const path =
      selected.type === "group"
        ? `/messages/group/${selected.id}`
        : `/messages/${selected.id}`;

    client
      .get(path)
      .then(({ data }) => {
        if (cancelled) return;
        setMessages(data.messages ?? []);
        markThreadRead(selected);
      })
      .catch((error) => {
        if (!cancelled) {
          setThreadError(
            error?.response?.data?.message ?? "Could not load messages."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected, markThreadRead]);

  // Member names for the open group, used to label typing indicators and
  // message authors. Refreshed whenever membership changes, otherwise anyone
  // added after the thread was opened renders as "Someone".
  const loadGroupMembers = useCallback((groupId) => {
    if (!groupId) return Promise.resolve();

    return client
      .get(`/groups/${groupId}`)
      .then(({ data }) => {
        const map = {};
        for (const member of data.group.members ?? []) {
          map[String(member._id)] = {
            username: member.username,
            profilePhoto: member.profilePhoto,
          };
        }
        setGroupMembers(map);
      })
      .catch(() => {
        /* names are cosmetic — the thread still works without them */
      });
  }, []);

  useEffect(() => {
    if (selected?.type !== "group") {
      setGroupMembers({});
      return;
    }

    loadGroupMembers(selected.id);
  }, [selected, loadGroupMembers]);

  const appendMessage = useCallback((message) => {
    setMessages((current) =>
      current.some((existing) => existing.id === message.id)
        ? current
        : [...current, message]
    );
  }, []);

  const bumpConversation = useCallback((target, message, { incrementUnread }) => {
    const matches = (entry) =>
      entry.type === (target.type === "group" ? "group" : "direct") &&
      (entry.type === "group" ? entry.group.id : entry.user.id) === target.id;

    // Read from the ref, not from inside the updater below: React may defer
    // the updater, so a flag set in there is not readable by the time this
    // returns — which previously caused a spurious refetch on every message.
    const found = conversationsRef.current.some(matches);

    setConversations((current) => {
      const index = current.findIndex(matches);
      if (index === -1) return current;

      const entry = current[index];
      const updated = {
        ...entry,
        lastMessage: {
          id: message.id,
          content: message.content,
          createdAt: message.createdAt,
          sender: message.sender,
        },
        unreadCount: incrementUnread ? (entry.unreadCount ?? 0) + 1 : 0,
      };

      return [updated, ...current.filter((_, i) => i !== index)];
    });

    return found;
  }, []);

  // Which conversation a message belongs to, regardless of direction.
  const targetOf = useCallback((message) => {
    if (message.group) return { type: "group", id: message.group };

    const me = meRef.current;
    return {
      type: "direct",
      id: message.sender === me ? message.recipient : message.sender,
    };
  }, []);

  useEffect(() => {
    if (!socket) return undefined;

    const onReceiveMessage = (message) => {
      const me = meRef.current;
      const target = targetOf(message);
      const open = selectedRef.current;
      const isOpenThread = open?.type === target.type && open?.id === target.id;

      if (isOpenThread) {
        appendMessage(message);
        if (message.sender !== me) markThreadRead(target);
      }

      const known = bumpConversation(target, message, {
        incrementUnread: !isOpenThread && message.sender !== me,
      });

      // First message in a conversation we don't know about yet — refetch to
      // pick up the peer's or group's details (the payload carries ids only).
      if (!known) loadConversations();
    };

    const onUserTyping = ({ userId, groupId }) => {
      const open = selectedRef.current;
      if (!open) return;

      const relevant = groupId
        ? open.type === "group" && open.id === groupId
        : open.type === "direct" && open.id === userId;
      if (!relevant) return;

      // An unknown id means our member map predates a membership change —
      // refresh it so the next render shows a real name.
      if (groupId && !groupMembersRef.current[userId]) loadGroupMembers(groupId);

      const username =
        groupMembersRef.current[userId]?.username ?? (groupId ? "Someone" : open.name);

      setTypers((current) => ({
        ...current,
        [userId]: { username, expiresAt: Date.now() + TYPING_EXPIRY_MS },
      }));
    };

    const onUserStoppedTyping = ({ userId, groupId }) => {
      const open = selectedRef.current;
      if (!open) return;

      const relevant = groupId
        ? open.type === "group" && open.id === groupId
        : open.type === "direct" && open.id === userId;
      if (!relevant) return;

      setTypers((current) => {
        const next = { ...current };
        delete next[userId];
        return next;
      });
    };

    const onGroupDisbanded = ({ groupId, groupName, disbandedBy }) => {
      setConversations((current) =>
        current.filter((entry) => !(entry.type === "group" && entry.group.id === groupId))
      );

      const open = selectedRef.current;
      if (open?.type === "group" && open.id === groupId) {
        setSelected(null);
        setMessages([]);
        setGroupInfoOpen(false);
        setTypers({});
        setNotice(
          disbandedBy === meRef.current
            ? `You disbanded “${groupName}”.`
            : `“${groupName}” was disbanded by an admin.`
        );
      }
    };

    const onMembershipChanged = ({
      groupId,
      type,
      groupName,
      updatedMembers,
      updatedAdmins,
      affectedUserId,
    }) => {
      const me = meRef.current;

      // We're echoed our own voluntary leave. handleGroupGone already showed
      // "You left …"; falling through would overwrite it with the wrong
      // "You were removed from …".
      if (type === "member_left" && String(affectedUserId) === String(me)) return;

      const stillMember = (updatedMembers ?? []).includes(String(me));
      const open = selectedRef.current;
      const isOpenThread = open?.type === "group" && open.id === groupId;

      // Removed from the group: drop it everywhere and close it if open.
      if (!stillMember) {
        setConversations((current) =>
          current.filter(
            (entry) => !(entry.type === "group" && entry.group.id === groupId)
          )
        );

        if (isOpenThread) {
          setSelected(null);
          setMessages([]);
          setGroupInfoOpen(false);
          setTypers({});
          setNotice(`You were removed from “${groupName}”.`);
        }
        return;
      }

      const known = conversationsRef.current.some(
        (entry) => entry.type === "group" && entry.group.id === groupId
      );

      // Just added — the group isn't in our list yet, so pull it in.
      if (!known) {
        loadConversations();
        if (type === "member_added") {
          setNotice(`You were added to “${groupName}”.`);
        }
        return;
      }

      // Already a member: patch counts and admin status in place.
      setConversations((current) =>
        current.map((entry) =>
          entry.type === "group" && entry.group.id === groupId
            ? {
                ...entry,
                group: {
                  ...entry.group,
                  name: groupName ?? entry.group.name,
                  memberCount: updatedMembers?.length ?? entry.group.memberCount,
                  isAdmin: (updatedAdmins ?? []).includes(String(me)),
                },
              }
            : entry
        )
      );

      if (isOpenThread) {
        // Names for authors/typers, and a nudge for the info panel to reload.
        loadGroupMembers(groupId);
        setGroupRefreshToken((token) => token + 1);
      }
    };

    const onProfileUpdated = ({ userId, profilePhoto }) => {
      // Our own photo, changed from another session of ours.
      if (String(userId) === String(meRef.current)) updateUser({ profilePhoto });

      setConversations((current) =>
        current.map((entry) =>
          entry.type === "direct" && entry.user.id === userId
            ? { ...entry, user: { ...entry.user, profilePhoto } }
            : entry
        )
      );

      setGroupMembers((current) =>
        current[userId]
          ? { ...current, [userId]: { ...current[userId], profilePhoto } }
          : current
      );

      // Nudge the info panel, which holds its own copy of the member list.
      if (selectedRef.current?.type === "group" && groupMembersRef.current[userId]) {
        setGroupRefreshToken((token) => token + 1);
      }
    };

    socket.on("receive_message", onReceiveMessage);
    socket.on("profile_updated", onProfileUpdated);
    socket.on("user_typing", onUserTyping);
    socket.on("user_stopped_typing", onUserStoppedTyping);
    socket.on("group_disbanded", onGroupDisbanded);
    socket.on("group_membership_changed", onMembershipChanged);

    return () => {
      socket.off("receive_message", onReceiveMessage);
      socket.off("profile_updated", onProfileUpdated);
      socket.off("user_typing", onUserTyping);
      socket.off("user_stopped_typing", onUserStoppedTyping);
      socket.off("group_disbanded", onGroupDisbanded);
      socket.off("group_membership_changed", onMembershipChanged);
    };
  }, [
    socket,
    appendMessage,
    bumpConversation,
    loadConversations,
    markThreadRead,
    targetOf,
    loadGroupMembers,
    updateUser,
  ]);

  // Drop typers whose expiry has passed, in case a typing_stop went missing.
  useEffect(() => {
    if (Object.keys(typers).length === 0) return undefined;

    const timer = setInterval(() => {
      const now = Date.now();
      setTypers((current) => {
        const next = Object.fromEntries(
          Object.entries(current).filter(([, value]) => value.expiresAt > now)
        );
        return Object.keys(next).length === Object.keys(current).length
          ? current
          : next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [typers]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, typers]);

  const stopTyping = useCallback(() => {
    clearTimeout(typingIdleTimer.current);

    const open = selectedRef.current;
    if (isTypingRef.current && socket && open) {
      socket.emit(
        "typing_stop",
        open.type === "group" ? { groupId: open.id } : { recipientId: open.id }
      );
    }

    isTypingRef.current = false;
    lastTypingEmitRef.current = 0;
  }, [socket]);

  const openConversation = (target) => {
    stopTyping();
    setTypers({});
    setSendError("");
    setNotice("");
    setDraft("");
    setPickerOpen(false);
    setGroupInfoOpen(false);
    setSelected(target);

    setConversations((current) =>
      current.map((entry) => {
        const id = entry.type === "group" ? entry.group.id : entry.user.id;
        const sameKind = (entry.type === "group") === (target.type === "group");
        return sameKind && id === target.id ? { ...entry, unreadCount: 0 } : entry;
      })
    );
  };

  const togglePicker = () => {
    setPickerOpen((open) => !open);
    setPeopleQuery("");

    if (people.length === 0) {
      client
        .get("/users")
        .then(({ data }) => setPeople(data.users ?? []))
        .catch((error) =>
          setPeopleError(error?.response?.data?.message ?? "Could not load people.")
        );
    }
  };

  const handleDraftChange = (event) => {
    setDraft(event.target.value);

    if (!socket || !selected) return;

    const now = Date.now();
    if (!isTypingRef.current || now - lastTypingEmitRef.current > TYPING_HEARTBEAT_MS) {
      socket.emit(
        "typing_start",
        selected.type === "group"
          ? { groupId: selected.id }
          : { recipientId: selected.id }
      );
      isTypingRef.current = true;
      lastTypingEmitRef.current = now;
    }

    clearTimeout(typingIdleTimer.current);
    typingIdleTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };

  const handleSend = (event) => {
    event.preventDefault();

    const content = draft.trim();
    if (!content || !selected || !socket) return;

    const target = selected;
    setDraft("");
    setSendError("");
    stopTyping();

    socket.emit(
      "send_message",
      target.type === "group"
        ? { groupId: target.id, content }
        : { recipientId: target.id, content },
      (ack) => {
        if (ack?.ok && ack.message) {
          appendMessage(ack.message);
          const known = bumpConversation(target, ack.message, {
            incrementUnread: false,
          });
          if (!known) loadConversations();
        } else {
          setSendError(ack?.error ?? "Message failed to send.");
          setDraft((current) => current || content);
        }
      }
    );
  };

  useEffect(() => () => clearTimeout(typingIdleTimer.current), []);

  const handleGroupCreated = (group) => {
    setGroupModalOpen(false);
    loadConversations();
    openConversation({ type: "group", id: group._id, name: group.name });
  };

  // Fired when the current user leaves or the group is deleted from this panel.
  const handleGroupGone = (reason) => {
    const gone = selectedRef.current;
    setGroupInfoOpen(false);

    if (gone) {
      setConversations((current) =>
        current.filter(
          (entry) => !(entry.type === "group" && entry.group.id === gone.id)
        )
      );
      setSelected(null);
      setMessages([]);
      setNotice(
        reason === "disbanded"
          ? `You disbanded “${gone.name}”.`
          : reason === "deleted"
            ? `You left “${gone.name}”, and it was deleted as you were the last member.`
            : `You left “${gone.name}”.`
      );
    }

    loadConversations();
  };

  const existingDirectIds = new Set(
    conversations.filter((e) => e.type === "direct").map((e) => e.user.id)
  );
  const pickerResults = people
    .filter((person) => !existingDirectIds.has(person.id))
    .filter((person) =>
      person.username.toLowerCase().includes(peopleQuery.trim().toLowerCase())
    );

  const typingNames = Object.values(typers).map((t) => t.username);

  // `selected.name` is a snapshot from when the thread was opened, so a rename
  // would leave the header stale. Prefer the live entry from the sidebar.
  const selectedEntry = selected
    ? conversations.find(
        (entry) =>
          entry.type === (selected.type === "group" ? "group" : "direct") &&
          (entry.type === "group" ? entry.group.id : entry.user.id) === selected.id
      )
    : null;
  const selectedName = selectedEntry
    ? selectedEntry.type === "group"
      ? selectedEntry.group.name
      : selectedEntry.user.username
    : selected?.name;

  return (
    <div className="chat-page">
      <header className="chat-header">
        <h1>SwiftChat</h1>
        <div className="chat-user">
          <span className={connected ? "chat-status online" : "chat-status"}>
            {connected ? "Connected" : "Connecting…"}
          </span>
          <NotificationBell onOpenTarget={openConversation} />
          <button
            type="button"
            className="profile-button"
            onClick={() => setProfileOpen(true)}
            aria-label="Open your profile"
          >
            <Avatar src={user?.profilePhoto} name={user?.username} size={26} />
            <span>{user?.username ?? "unknown"}</span>
          </button>
          <button type="button" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <main className="chat-body">
        <aside className="chat-sidebar">
          <div className="chat-sidebar-head">
            <h2>Chats</h2>
            <span className="chat-sidebar-buttons">
              <button type="button" className="chat-new-button" onClick={togglePicker}>
                {pickerOpen ? "Cancel" : "New chat"}
              </button>
              <button
                type="button"
                className="chat-new-button"
                onClick={() => setGroupModalOpen(true)}
              >
                New group
              </button>
            </span>
          </div>

          {pickerOpen && (
            <div className="chat-picker">
              <input
                type="search"
                value={peopleQuery}
                onChange={(event) => setPeopleQuery(event.target.value)}
                placeholder="Search people…"
                aria-label="Search people"
              />
              {peopleError && <p className="auth-error">{peopleError}</p>}
              {pickerResults.length === 0 ? (
                <p className="chat-placeholder">No one new to message.</p>
              ) : (
                <ul className="chat-user-list">
                  {pickerResults.map((person) => (
                    <li key={person.id}>
                      <button
                        type="button"
                        className="chat-user-button"
                        onClick={() =>
                          openConversation({
                            type: "direct",
                            id: person.id,
                            name: person.username,
                          })
                        }
                      >
                        <span
                          className={
                            onlineUsers.includes(person.id)
                              ? "chat-dot online"
                              : "chat-dot"
                          }
                          aria-hidden="true"
                        />
                        <span className="chat-user-name">{person.username}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {loadingConversations && (
            <p className="chat-placeholder">Loading conversations…</p>
          )}
          {conversationsError && <p className="auth-error">{conversationsError}</p>}
          {!loadingConversations && !conversationsError && conversations.length === 0 && (
            <p className="chat-placeholder">
              Nothing yet. Start a chat or create a group.
            </p>
          )}

          <ConversationList
            conversations={conversations}
            selected={selected}
            currentUserId={user?.id}
            onlineUsers={onlineUsers}
            onOpen={openConversation}
          />
        </aside>

        <section className="chat-thread">
          {notice && (
            <p className="chat-notice" role="status">
              {notice}
            </p>
          )}

          {!selected ? (
            <p className="chat-placeholder">
              Select a conversation to start chatting.
            </p>
          ) : (
            <>
              <div className="chat-thread-header">
                {selected.type === "direct" && (
                  <Avatar
                    src={selectedEntry?.user?.profilePhoto}
                    name={selectedName}
                    size={28}
                  />
                )}
                <strong>{selectedName}</strong>
                {selected.type === "direct" && onlineUsers.includes(selected.id) && (
                  <span className="chat-online-label">online</span>
                )}
                {selected.type === "group" && (
                  <button
                    type="button"
                    className="chat-new-button"
                    onClick={() => setGroupInfoOpen((open) => !open)}
                  >
                    {groupInfoOpen ? "Hide info" : "Group info"}
                  </button>
                )}
              </div>

              <div className="chat-messages">
                {loadingMessages && (
                  <p className="chat-placeholder">Loading messages…</p>
                )}
                {threadError && <p className="auth-error">{threadError}</p>}
                {!loadingMessages && !threadError && messages.length === 0 && (
                  <p className="chat-placeholder">No messages yet. Say something.</p>
                )}

                {messages.map((message) => {
                  const mine = message.sender === user?.id;

                  return (
                    <div
                      key={message.id}
                      className={mine ? "chat-message mine" : "chat-message theirs"}
                    >
                      {/* Group threads need an author label; 1:1 doesn't. */}
                      {!mine && selected.type === "group" && (
                        <span className="chat-message-author">
                          <Avatar
                            src={groupMembers[message.sender]?.profilePhoto}
                            name={groupMembers[message.sender]?.username}
                            size={18}
                          />
                          {groupMembers[message.sender]?.username ?? "Unknown"}
                        </span>
                      )}
                      <p className="chat-message-content">{message.content}</p>
                      <time className="chat-message-time">
                        {formatTime(message.createdAt)}
                      </time>
                    </div>
                  );
                })}

                <div ref={bottomRef} />
              </div>

              <p className="chat-typing" aria-live="polite">
                {typingLabel(typingNames)}
              </p>

              {sendError && <p className="auth-error">{sendError}</p>}

              <form className="chat-composer" onSubmit={handleSend}>
                <input
                  type="text"
                  value={draft}
                  onChange={handleDraftChange}
                  placeholder={`Message ${selectedName}`}
                  aria-label={`Message ${selectedName}`}
                  disabled={!connected}
                />
                <button type="submit" disabled={!connected || !draft.trim()}>
                  Send
                </button>
              </form>
            </>
          )}
        </section>

        {selected?.type === "group" && groupInfoOpen && (
          <GroupInfoPanel
            groupId={selected.id}
            currentUserId={user?.id}
            refreshToken={groupRefreshToken}
            onClose={() => setGroupInfoOpen(false)}
            onChanged={() => {
              loadConversations();
              loadGroupMembers(selected.id);
            }}
            onGone={handleGroupGone}
          />
        )}
      </main>

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}

      {groupModalOpen && (
        <NewGroupModal
          onClose={() => setGroupModalOpen(false)}
          onCreated={handleGroupCreated}
        />
      )}
    </div>
  );
};

export default Chat;
