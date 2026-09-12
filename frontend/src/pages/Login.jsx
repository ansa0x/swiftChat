import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext.jsx";
import { validateEmail, validateExistingPassword } from "../utils/validation.js";
import AuthLayout from "../components/AuthLayout.jsx";
import "../styles/auth.css";

const Login = () => {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [values, setValues] = useState({ email: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (name) => (event) => {
    setValues((current) => ({ ...current, [name]: event.target.value }));
    // Clear the error for a field as soon as the user edits it.
    setFieldErrors((current) => ({ ...current, [name]: null }));
    setFormError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const errors = {
      email: validateEmail(values.email),
      password: validateExistingPassword(values.password),
    };

    if (errors.email || errors.password) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setFormError("");
    setSubmitting(true);

    try {
      await login(values.email.trim(), values.password);
      navigate("/chat", { replace: true });
    } catch (error) {
      // The backend returns the same message for an unknown email and a wrong
      // password, so it can't be used to probe which emails are registered.
      setFormError(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <span className="auth-eyebrow">SwiftChat</span>

      <h1>Welcome back</h1>
      <p className="auth-sub">Log in to pick up where you left off.</p>

      <form onSubmit={handleSubmit} noValidate>
        {formError && (
          <p className="auth-error" role="alert">
            {formError}
          </p>
        )}

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
            autoComplete="current-password"
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? "password-error" : undefined}
            disabled={submitting}
          />
          {fieldErrors.password && (
            <p className="auth-field-error" id="password-error">
              {fieldErrors.password}
            </p>
          )}
        </div>

        <button type="submit" className="auth-submit" disabled={submitting}>
          {submitting ? "Logging in…" : "Log in"}
        </button>
      </form>

      <p className="auth-switch">
        New to SwiftChat? <Link to="/register">Create an account</Link>
      </p>
    </AuthLayout>
  );
};

export default Login;
