import { useEffect, useRef, useState } from "react";

import client from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import Avatar from "./Avatar.jsx";

// Mirrors the server's multer limits so the user gets instant feedback. The
// server remains the real gate — these checks are trivially bypassable.
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const describeSize = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)}MB`;

const validateFile = (file) => {
  if (!file.type?.startsWith("image/")) {
    return "That file isn't an image. Choose a JPG, PNG, GIF or WebP.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That image is ${describeSize(file.size)}. The limit is 5MB.`;
  }
  return null;
};

const ProfileModal = ({ onClose }) => {
  const { user, updateUser } = useAuth();

  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState("");
  const inputRef = useRef(null);

  // Object URLs leak until revoked, so tie each one to its file.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return undefined;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handleSelect = (event) => {
    const chosen = event.target.files?.[0];
    setDone("");

    if (!chosen) {
      setFile(null);
      setError("");
      return;
    }

    const problem = validateFile(chosen);
    if (problem) {
      setFile(null);
      setError(problem);
      // Clear the input so re-picking the same bad file still fires onChange.
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setError("");
    setFile(chosen);
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!file) return;

    setUploading(true);
    setError("");
    setDone("");

    try {
      const form = new FormData();
      form.append("photo", file);

      const { data } = await client.post("/upload/profile-photo", form);

      updateUser({
        profilePhoto: data.user.profilePhoto,
        profilePhotoId: data.user.profilePhotoId,
      });

      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setDone("Profile photo updated.");
    } catch (err) {
      setError(err?.response?.data?.message ?? "Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Profile">
      <form className="modal" onSubmit={handleUpload}>
        <h2>Your profile</h2>

        <div className="profile-current">
          <Avatar
            src={previewUrl ?? user?.profilePhoto}
            name={user?.username}
            size={72}
          />
          <div>
            <strong>{user?.username}</strong>
            <p className="chat-hint">{user?.email}</p>
            {previewUrl && <p className="chat-hint">Preview — not saved yet.</p>}
          </div>
        </div>

        <label htmlFor="photo-input">Profile photo</label>
        <input
          id="photo-input"
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={handleSelect}
          disabled={uploading}
        />
        <p className="chat-hint">JPG, PNG, GIF or WebP. Up to 5MB.</p>

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        {done && <p className="profile-success">{done}</p>}

        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={uploading}>
            Close
          </button>
          <button type="submit" className="primary" disabled={!file || uploading}>
            {uploading ? "Uploading…" : "Upload photo"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ProfileModal;
