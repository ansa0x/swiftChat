import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext.jsx";
import {
  MIN_PASSWORD_LENGTH,
  validateEmail,
  validateNewPassword,
  validateUsername,
} from "../utils/validation.js";
import AuthLayout from "../components/AuthLayout.jsx";
import "../styles/auth.css";

const Register = () => {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [values, setValues] = useState({ username: "", email: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (name) => (event) => {
    setValues((current) => ({ ...current, [name]: event.target.value }));
    setFieldErrors((current) => ({ ...current, [name]: null }));
    setFormError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const errors = {
      username: validateUsername(values.username),
      email: validateEmail(values.email),
      password: validateNewPassword(values.password),
    };

    if (errors.username || errors.email || errors.password) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setFormError("");
    setSubmitting(true);

    try {
      await register(values.username.trim(), values.email.trim(), values.password);
      navigate("/chat", { replace: true });
    } catch (error) {
      // A 409 carries the colliding field, so the message can sit against the
      // offending input rather than only at the top of the form.
      if (error.status === 409 && error.field) {
        setFieldErrors({ [error.field]: error.message });
      } else {
        setFormError(error.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <span className="auth-eyebrow">SwiftChat</span>

      <h1>Create your account</h1>
      <p className="auth-sub">A minute to set up, then you&apos;re talking.</p>

      <form onSubmit={handleSubmit} noValidate>
        {formError && (
          <p className="auth-error" role="alert">
            {formError}
          </p>
        )}

        <div className="auth-field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            name="username"
            type="text"
            value={values.username}
            onChange={handleChange("username")}
            placeholder="yourname"
            autoComplete="username"
            aria-invalid={Boolean(fieldErrors.username)}
            aria-describedby={fieldErrors.username ? "username-error" : undefined}
            disabled={submitting}
          />
          {fieldErrors.username && (
            <p className="auth-field-error" id="username-error">
              {fieldErrors.username}
            </p>
          )}
        </div>

        <div className="auth-field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            value={values.email}
            onChange={handleChange("email")}
            placeholder="you@example.com"
            autoComplete="email"
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "email-error" : undefined}
            disabled={submitting}
          />
          {fieldErrors.email && (
            <p className="auth-field-error" id="email-error">
              {fieldErrors.email}
            </p>
          )}
        </div>

        <div className="auth-field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            value={values.password}
            onChange={handleChange("password")}
            placeholder="••••••••"
            autoComplete="new-password"
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={
              fieldErrors.password ? "password-error" : "password-hint"
            }
            disabled={submitting}
          />
          {fieldErrors.password ? (
            <p className="auth-field-error" id="password-error">
              {fieldErrors.password}
            </p>
          ) : (
            <p className="auth-hint" id="password-hint">
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          )}
        </div>

        <button type="submit" className="auth-submit" disabled={submitting}>
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="auth-switch">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </AuthLayout>
  );
};

export default Register;
