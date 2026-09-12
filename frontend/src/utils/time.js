const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const startOfDay = (date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

// Compact relative label for the conversation list: "now", "4m", "3h",
// "Yesterday", "Mon", then a date once it's over a week old.
export const relativeTime = (iso) => {
  if (!iso) return "";

  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";

  const now = new Date();
  const diff = now.getTime() - then.getTime();

  if (diff < MINUTE) return "now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;

  // Compare calendar days rather than elapsed hours, so 11pm → 1am reads as
  // "Yesterday" instead of "2h".
  const dayGap = Math.round((startOfDay(now) - startOfDay(then)) / DAY);

  if (dayGap === 0) return `${Math.floor(diff / HOUR)}h`;
  if (dayGap === 1) return "Yesterday";
  if (dayGap < 7) return then.toLocaleDateString([], { weekday: "short" });

  return then.toLocaleDateString([], { month: "short", day: "numeric" });
};

export const truncate = (text, max = 38) => {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};
