import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";

import { useAuth } from "./AuthContext.jsx";

export const SOCKET_URL = "http://localhost:5000";

const SocketContext = createContext(null);

export const SocketProvider = ({ children }) => {
  const { token } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState([]);

  useEffect(() => {
    // No token means logged out — tear down any existing connection.
    if (!token) {
      setSocket(null);
      setConnected(false);
      setOnlineUsers([]);
      return undefined;
    }

    const next = io(SOCKET_URL, {
      auth: { token },
      transports: ["websocket"],
    });

    next.on("connect", () => setConnected(true));
    next.on("disconnect", () => setConnected(false));
    next.on("connect_error", (error) => {
      console.error("socket connect_error:", error.message);
      setConnected(false);
    });

    next.on("online_users", ({ users }) => setOnlineUsers(users ?? []));
    next.on("user_online", ({ userId }) =>
      setOnlineUsers((current) =>
        current.includes(userId) ? current : [...current, userId]
      )
    );
    next.on("user_offline", ({ userId }) =>
      setOnlineUsers((current) => current.filter((id) => id !== userId))
    );

    setSocket(next);

    // Runs on logout and on token change, so a stale socket never lingers.
    return () => {
      next.removeAllListeners();
      next.close();
    };
  }, [token]);

  const value = useMemo(
    () => ({ socket, connected, onlineUsers }),
    [socket, connected, onlineUsers]
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
};

export const useSocket = () => {
  const context = useContext(SocketContext);

  if (!context) {
    throw new Error("useSocket must be used inside a SocketProvider.");
  }

  return context;
};

export default SocketContext;
