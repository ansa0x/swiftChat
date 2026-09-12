import Avatar from "./Avatar.jsx";
import { relativeTime, truncate } from "../utils/time.js";

const GroupIcon = () => (
  <svg className="chat-group-icon" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="5.5" cy="5.5" r="2.4" />
    <circle cx="11" cy="6" r="2" />
    <path d="M1 13.5c0-2.2 2-3.6 4.5-3.6s4.5 1.4 4.5 3.6z" />
    <path d="M11 10c2.2 0 4 1.2 4 3.1v.4h-3.6c0-1.2-.4-2.3-1.2-3.1z" />
  </svg>
);

const ConversationList = ({ conversations, selected, currentUserId, onlineUsers, onOpen }) => (
  <ul className="chat-conversation-list">
    {conversations.map((entry) => {
      const isGroup = entry.type === "group";
      const id = isGroup ? entry.group.id : entry.user.id;
      const name = isGroup ? entry.group.name : entry.user.username;
      const isSelected =
        selected?.id === id &&
        selected?.type === (isGroup ? "group" : "direct");

      return (
        <li key={`${entry.type}:${id}`}>
          <button
            type="button"
            className={isSelected ? "chat-conversation selected" : "chat-conversation"}
            onClick={() =>
              onOpen(
                isGroup
                  ? { type: "group", id, name }
                  : { type: "direct", id, name }
              )
            }
          >
            {isGroup ? (
              <GroupIcon />
            ) : (
              <span className="avatar-wrap">
                <Avatar src={entry.user.profilePhoto} name={name} size={30} />
                <span
                  className={
                    onlineUsers.includes(id)
                      ? "chat-dot corner online"
                      : "chat-dot corner"
                  }
                  aria-hidden="true"
                />
              </span>
            )}

            <span className="chat-conversation-body">
              <span className="chat-conversation-top">
                <span className="chat-user-name">{name}</span>
                <span className="chat-conversation-time">
                  {relativeTime(entry.lastMessage?.createdAt)}
                </span>
              </span>
              <span className="chat-conversation-preview">
                {entry.lastMessage
                  ? `${
                      entry.lastMessage.sender === currentUserId ? "You: " : ""
                    }${truncate(entry.lastMessage.content)}`
                  : isGroup
                    ? `${entry.group.memberCount} members · no messages yet`
                    : "No messages yet"}
              </span>
            </span>

            {entry.unreadCount > 0 && (
              <span className="chat-unread" aria-label={`${entry.unreadCount} unread`}>
                {entry.unreadCount}
              </span>
            )}
          </button>
        </li>
      );
    })}
  </ul>
);

export default ConversationList;
