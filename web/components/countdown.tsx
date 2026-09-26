"use client";
import { useEffect, useState } from "react";
import { countdown } from "@/lib/format";

/** Updates every 30 s — the only motion in the app. */
export function Countdown({ at }: { at: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return <span className="board-countdown">{countdown(at, now)}</span>;
}
