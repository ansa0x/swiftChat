/**
 * Origins allowed to call the API and open a socket.
 *
 * Local dev is always permitted so running the app locally never depends on an
 * env var being set. FRONTEND_URL adds the deployed frontend on top, which
 * means going live is an environment change rather than a code change.
 *
 * Accepts a comma-separated list, so a preview deployment can be allowed
 * alongside production without another release.
 *
 * Read at import time, which is safe because index.js loads dotenv before any
 * other import.
 */
const LOCAL_DEV_ORIGIN = "http://localhost:5173";

const fromEnv = (process.env.FRONTEND_URL ?? "")
  .split(",")
  // Trailing slashes never appear in a browser's Origin header, so strip them
  // rather than silently failing to match.
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

export const allowedOrigins = [...new Set([LOCAL_DEV_ORIGIN, ...fromEnv])];

export default allowedOrigins;
