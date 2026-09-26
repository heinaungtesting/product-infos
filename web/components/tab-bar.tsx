"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Today", match: (p: string) => p === "/" },
  { href: "/pipeline", label: "Pipeline", match: (p: string) => p.startsWith("/pipeline") || p.startsWith("/jobs") },
  { href: "/readiness", label: "Readiness", match: (p: string) => p.startsWith("/readiness") },
  { href: "/hermes", label: "Hermes", match: (p: string) => p.startsWith("/hermes") },
];

export function TabBar() {
  const path = usePathname();
  return (
    <nav className="tabs" aria-label="Main">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className="tab" aria-current={t.match(path) ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
