"use client";
import { useEffect, useState } from "react";

/**
 * Registers the shell-only service worker and hides the whole app when offline,
 * so nothing stale (deadlines, jobs, chat) is ever shown as current.
 */
export function OfflineGuard() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!offline) return null;
  return (
    <div className="offline" role="alert">
      <div>
        <h1>Offline</h1>
        <p>Live data and actions are unavailable. Nothing is stored on this phone, so there is nothing to show until you reconnect.</p>
      </div>
    </div>
  );
}
