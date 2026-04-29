"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  eyebrow: string;
  matchPrefix?: string;
};

const NAV: NavItem[] = [
  { href: "/", label: "Social", eyebrow: "Content & growth", matchPrefix: "__root__" },
  { href: "/app", label: "App", eyebrow: "Mobile analytics", matchPrefix: "/app" },
];

function isActive(pathname: string, item: NavItem) {
  if (item.matchPrefix === "__root__") return pathname === "/";
  return item.matchPrefix ? pathname.startsWith(item.matchPrefix) : pathname === item.href;
}

export default function TopNav() {
  const pathname = usePathname() || "/";

  return (
    <nav className="sticky top-0 z-30 border-b border-white/5 bg-[#100814]/70 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-6 px-6 py-3">
        <Link href="/" className="group flex items-center gap-3" aria-label="Catharsis home">
          {/* Inline SVG so the mark inherits brand color via currentColor and
              ships in the document (zero round-trip). The same artwork lives
              at /public/catharsis-logo.svg + /app/icon.svg for OG / favicon. */}
          <svg
            viewBox="0 0 100 100"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinejoin="miter"
            strokeLinecap="square"
            className="h-8 w-8 text-[#e7b894] transition group-hover:text-[#fff3e0] drop-shadow-[0_0_10px_rgba(231,184,148,0.45)]"
            aria-hidden
          >
            <path d="M 18 22 H 70 V 34 H 60 V 44 H 70 V 70 H 18 Z" />
            <path d="M 30 30 H 82 V 56 H 72 V 66 H 82 V 78 H 30 Z" />
            <path
              d="M 50 38 L 53 50 L 65 53 L 53 56 L 50 68 L 47 56 L 35 53 L 47 50 Z"
              fill="currentColor"
              stroke="none"
            />
          </svg>
          <span className="font-display text-lg tracking-tight text-[#f3e7d7]">Catharsis</span>
        </Link>

        <div className="flex items-center gap-1 rounded-full border border-white/5 bg-black/20 p-1">
          {NAV.map((item) => {
            const active = isActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "group relative rounded-full px-4 py-1.5 text-sm transition",
                  active
                    ? "bg-[#f3e7d7] text-[#2a1220]"
                    : "text-[#d9c9bc] hover:bg-white/5 hover:text-[#f3e7d7]",
                ].join(" ")}
              >
                <span className="flex items-center gap-2">
                  <span className="font-display text-[15px] leading-none">{item.label}</span>
                  <span
                    className={[
                      "hidden text-[10px] uppercase tracking-[0.18em] sm:inline",
                      active ? "text-[#6b3f33]" : "text-[#8f7d8c] group-hover:text-[#b9a7b6]",
                    ].join(" ")}
                  >
                    {item.eyebrow}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
