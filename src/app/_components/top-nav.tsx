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
        <Link href="/" className="group flex items-center gap-3">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#e7b894]/15 ring-1 ring-[#e7b894]/40 transition group-hover:ring-[#e7b894]/70">
            <span className="h-1.5 w-1.5 rounded-full bg-[#e7b894] shadow-[0_0_12px_rgba(231,184,148,0.9)]" />
          </span>
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
