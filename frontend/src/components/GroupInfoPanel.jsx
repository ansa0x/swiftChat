import { useEffect, useState } from "react";

import client from "../api/client.js";
import Avatar from "./Avatar.jsx";

/**
 * Member list plus management actions. Admin-only controls are gated on the
 * group's `admins` array from the server, not on client-side assumptions —
 * the backend enforces the same rule, so this is presentation only.
 */
const GroupInfoPanel = ({
  groupId,
  currentUserId,
  refreshToken = 0,
  onClose,
  onChanged,
  onGone,
}) => {
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [people, setPeople] = useState([]);

  const load = () =>
    client
      .get(`/groups/${groupId}`)
      .then(({ data }) => {
        setGroup(data.group);
        setNewName(data.group.name);
        setError("");
      })
      .catch((err) => {
        if (err?.response?.status === 404) {
          onGone?.();
          return;
        }
        setError(err?.response?.data?.message ?? "Could not load group.");
      });

  // refreshToken changes when a group_membership_changed event arrives, so the
  // panel reflects other admins' actions without being reopened.
  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, refreshToken]);

  const isAdmin = Boolean(
    group?.admins?.some((admin) => String(admin._id) === String(currentUserId))
  );

  // Wraps every mutating action: single busy flag, refreshes both this panel
  // and the parent's sidebar, and surfaces the server's message on failure.
  const run = async (action, { refresh = true } = {}) => {
    setBusy(true);
    setError("");

    try {
      await action();
      if (refresh) await load();
      onChanged?.();
    } catch (err) {
      setError(err?.response?.data?.message ?? "That action failed.");
    } finally {
      setBusy(false);
    }
  };

  const openAddMember = () => {
    setAddOpen((open) => !open);

    if (people.length === 0) {
      client
        .get("/users")
        .then(({ data }) => setPeople(data.users ?? []))
        .catch(() => setError("Could not load people."));
    }
  };

  const memberIds = new Set((group?.members ?? []).map((m) => String(m._id)));
  const addable = people.filter((person) => !memberIds.has(person.id));

  if (loading) {
    return (
      <aside className="group-panel">
        <p className="chat-placeholder">Loading group…</p>
      </aside>
    );
  }

  if (!group) {
    return (
      <aside className="group-panel">
        <div className="group-panel-head">
          <h3>Group</h3>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {error && <p className="auth-error">{error}</p>}
      </aside>
    );
  }

  return (
    <aside className="group-panel">
      <div className="group-panel-head">
        <h3>{group.name}</h3>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <p className="chat-hint">
        {group.members.length} member{group.members.length === 1 ? "" : "s"}
        {isAdmin ? " · you are an admin" : ""}
      </p>

      {error && <p className="auth-error">{error}</p>}

      {isAdmin && (
        <div className="group-panel-section">
          {renaming ? (
            <div className="group-rename">
              <input
                type="text"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                aria-label="New group name"
                disabled={busy}
              />
              <button
                type="button"
                className="primary"
                disabled={busy || !newName.trim()}
                onClick={() =>
                  run(() =>
                    client.patch(`/groups/${groupId}/name`, { name: newName.trim() })
                  ).then(() => setRenaming(false))
                }
              >
                Save
              </button>
              <button type="button" onClick={() => setRenaming(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setRenaming(true)} disabled={busy}>
              Rename group
            </button>
          )}
        </div>
      )}

      <ul className="group-member-list">
        {group.members.map((member) => {
          const id = String(member._id);
          const memberIsAdmin = group.admins.some((a) => String(a._id) === id);
          const isSelf = id === String(currentUserId);

          return (
            <li key={id} className="group-member">
              <span className="group-member-name">
                <Avatar src={member.profilePhoto} name={member.username} size={24} />
                <span>
                  {member.username}
                  {isSelf && " (you)"}
                  {memberIsAdmin && <span className="group-admin-tag">admin</span>}
                </span>
              </span>

              {isAdmin && !isSelf && (
                <span className="group-member-actions">
                  {memberIsAdmin ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          client.patch(`/groups/${groupId}/admins/${id}/demote`)
                        )
                      }
                    >
                      Demote
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          client.patch(`/groups/${groupId}/admins/${id}/promote`)
                        )
                      }
                    >
                      Promote
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(() => client.delete(`/groups/${groupId}/members/${id}`))
                    }
                  >
                    Remove
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {isAdmin && (
        <div className="group-panel-section">
          <button type="button" onClick={openAddMember} disabled={busy}>
            {addOpen ? "Cancel" : "Add member"}
          </button>

          {addOpen && (
            <ul className="modal-list">
              {addable.length === 0 && (
                <li className="chat-placeholder">Everyone is already in.</li>
              )}
              {addable.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    className="chat-user-button"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        client.post(`/groups/${groupId}/members`, {
                          userId: person.id,
                        })
                      ).then(() => setAddOpen(false))
                    }
                  >
                    {person.username}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="group-panel-section group-danger">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(
              async () => {
                const { data } = await client.post(`/groups/${groupId}/leave`);
                // Either way the caller is out of the group.
                onGone?.(data?.deleted ? "deleted" : "left");
              },
              { refresh: false }
            )
          }
        >
          Leave group
        </button>

        {isAdmin && (
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() =>
              run(
                async () => {
                  await client.delete(`/groups/${groupId}`);
                  // The socket event handles the UI; this is the local echo.
                  onGone?.("disbanded");
                },
                { refresh: false }
              )
            }
          >
            Disband group
          </button>
        )}
      </div>
    </aside>
  );
};

export default GroupInfoPanel;
