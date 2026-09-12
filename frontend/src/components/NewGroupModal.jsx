import { useEffect, useState } from "react";

import client from "../api/client.js";

const NewGroupModal = ({ onClose, onCreated }) => {
  const [name, setName] = useState("");
  const [people, setPeople] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    client
      .get("/users")
      .then(({ data }) => setPeople(data.users ?? []))
      .catch((err) =>
        setError(err?.response?.data?.message ?? "Could not load people.")
      );
  }, []);

  const toggle = (id) =>
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    );

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!name.trim()) {
      setError("Group name is required.");
      return;
    }

    setError("");
    setSubmitting(true);

    try {
      const { data } = await client.post("/groups", {
        name: name.trim(),
        memberIds: selectedIds,
      });
      onCreated(data.group);
    } catch (err) {
      setError(err?.response?.data?.message ?? "Could not create group.");
    } finally {
      setSubmitting(false);
    }
  };

  const visible = people.filter((person) =>
    person.username.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Create a group">
      <form className="modal" onSubmit={handleSubmit}>
        <h2>New group</h2>

        <label htmlFor="group-name">Group name</label>
        <input
          id="group-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Weekend plans"
          disabled={submitting}
        />

        <label htmlFor="group-search">
          Members {selectedIds.length > 0 && `(${selectedIds.length} selected)`}
        </label>
        <input
          id="group-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search people…"
          disabled={submitting}
        />

        <ul className="modal-list">
          {visible.length === 0 && <li className="chat-placeholder">No people found.</li>}
          {visible.map((person) => (
            <li key={person.id}>
              <label className="modal-check">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(person.id)}
                  onChange={() => toggle(person.id)}
                  disabled={submitting}
                />
                <span>{person.username}</span>
              </label>
            </li>
          ))}
        </ul>

        {error && <p className="auth-error">{error}</p>}

        <p className="chat-hint">
          You&apos;ll be added as a member and admin automatically.
        </p>

        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? "Creating…" : "Create group"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default NewGroupModal;
