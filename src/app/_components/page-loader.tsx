// Branded loading shell shared by /app and /. Renders the moment a navigation
// starts (Next.js shows the route's loading.tsx while the matching page.tsx's
// server work resolves). Without this, navigating to /app hangs on the
// previous page until every API call lands — which is why pages "feel slow"
// even when the underlying fetch latency is fine.

export default function PageLoader({ label = "loading" }: { label?: string }) {
  return (
    <main className="min-h-screen text-[#f3e7d7]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-6 py-10">
        {/* Header skeleton — mirrors the real header card so layout doesn't jump. */}
        <div className="card-glass relative overflow-hidden rounded-[2rem] p-8 sm:p-10">
          <div className="flex items-center gap-4">
            <CatharsisMark spinning />
            <div className="flex flex-col gap-2">
              <span className="font-display text-2xl text-[#f3e7d7]">Catharsis</span>
              <span className="text-[11px] uppercase tracking-[0.28em] text-[#8f7d8c]">
                {label}…
              </span>
            </div>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonTile key={i} />
            ))}
          </div>
          <Shimmer />
        </div>

        {/* Body skeleton — three placeholder panels suggest the upcoming layout. */}
        <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
          <SkeletonPanel rows={6} />
          <SkeletonPanel rows={6} />
        </div>
        <SkeletonPanel rows={4} />
      </div>
    </main>
  );
}

function SkeletonTile() {
  return (
    <div className="rounded-2xl border border-white/5 bg-black/15 p-4">
      <div className="h-2 w-20 rounded bg-white/10" />
      <div className="mt-4 h-7 w-24 rounded bg-white/15" />
      <div className="mt-3 h-2 w-28 rounded bg-white/5" />
    </div>
  );
}

function SkeletonPanel({ rows }: { rows: number }) {
  return (
    <div className="card-glass relative overflow-hidden rounded-3xl p-5">
      <div className="h-3 w-32 rounded bg-white/10" />
      <div className="mt-5 flex flex-col gap-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="h-3 rounded bg-white/5"
            style={{ width: `${60 + ((i * 13) % 35)}%` }}
          />
        ))}
      </div>
      <Shimmer />
    </div>
  );
}

function Shimmer() {
  // Pure-CSS sweep that moves a translucent gradient across the card. Doesn't
  // require any extra animation utility — gradient + animate-pulse blend works
  // well enough at this opacity.
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/[0.04] to-transparent"
    />
  );
}

function CatharsisMark({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinejoin="miter"
      strokeLinecap="square"
      className={`h-10 w-10 text-[#e7b894] drop-shadow-[0_0_14px_rgba(231,184,148,0.55)] ${
        spinning ? "animate-pulse" : ""
      }`}
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
  );
}
