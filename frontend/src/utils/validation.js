// The backend does not enforce a password length (authController only checks
// that the field is present), so this is a client-side floor for new accounts.
export const MIN_PASSWORD_LENGTH = 8;

// Deliberately permissive: catches typos like a missing @ or domain without
// rejecting unusual-but-valid addresses.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateEmail = (email) => {
  const value = email.trim();

  if (!value) return "Email is required.";
  if (!EMAIL_PATTERN.test(value)) return "Enter a valid email address.";

  return null;
};

export const validateUsername = (username) => {
  const value = username.trim();

  if (!value) return "Username is required.";
  if (value.length < 3) return "Username must be at least 3 characters.";

  return null;
};

// Only applied when creating an account. Existing accounts may predate this
// rule, so the login form must not reject a short password locally — that
// would lock those users out of an account the backend would happily accept.
export const validateNewPassword = (password) => {
  if (!password) return "Password is required.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  return null;
};

export const validateExistingPassword = (password) =>
  password ? null : "Password is required.";
