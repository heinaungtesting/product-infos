"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark, Icon, type IconName } from "./icons";

const TABS: { href: string; label: string; icon: IconName; match: (p: string) => boolean }[] = [
  { href: "/", label: "Today", icon: "today", match: (p) => p === "/" },
  { href: "/pipeline", label: "Pipeline", icon: "pipeline", match: (p) => p.startsWith("/pipeline") || p.startsWith("/jobs") },
  { href: "/readiness", label: "Evidence", icon: "evidence", match: (p) => p.startsWith("/readiness") },
  { href: "/hermes", label: "Hermes", icon: "chat", match: (p) => p.startsWith("/hermes") },
];

/** Phone: fixed bottom bar with icons. */
export function TabBar() {
  const path = usePathname();
  return (
    <nav className="tabs" aria-label="Main">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className="tab" aria-current={t.match(path) ? "page" : undefined}>
          <Icon name={t.icon} size={24} strokeWidth={t.match(path) ? 2.4 : 1.8} />
          <span>{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}

/** Desktop: left sidebar with brand, nav and an optional footer widget. */
export function Sidebar({ footer }: { footer?: React.ReactNode }) {
  const path = usePathname();
  return (
    <aside className="sidebar">
      <Link href="/" className="brand">
        <BrandMark size={36} />
        <span>
          <strong>Job OS</strong>
          <small>Plan. Apply. Progress.</small>
        </span>
      </Link>
      <nav className="side-nav" aria-label="Main">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className="side-link" aria-current={t.match(path) ? "page" : undefined}>
            <Icon name={t.icon} size={22} strokeWidth={1.8} />
            {t.label}
          </Link>
        ))}
      </nav>
      {footer}
    </aside>
  );
}
