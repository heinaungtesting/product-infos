"use client";
import { useEffect, useState } from "react";
import { countdown } from "@/lib/format";

/** Updates every 30 s. */
export function Countdown({ at }: { at: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return <span className="countdown num" title="Time until start" suppressHydrationWarning>in {countdown(at, now)}</span>;
}
