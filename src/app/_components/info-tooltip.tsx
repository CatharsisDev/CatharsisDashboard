// Tiny "(?)" badge that reveals an explanation on hover or focus. Pure CSS
// (no client component needed) — works in server components and stays
// keyboard-accessible because the wrapping span is focusable and we trigger
// the popover via group-focus-within. The native `title` attr also fires so
// touch devices get the same explanation on long-press.
//
// Shared across /, /app, and /web wherever a number's definition isn't
// obvious from its label. We render the "?" as an inline SVG `<text>` with
// `dominantBaseline="central"` so the glyph sits perfectly centered inside
// the circle — using literal `?` text with flex-centering leaves it
// looking slightly low because the question-mark's visual mass is in its
// upper hook, not its geometric centre.

export default function InfoTooltip({
  text,
  position = "top",
}: {
  text: string;
  position?: "top" | "right" | "left" | "bottom";
}) {
  return (
    <span className="group/info relative inline-flex align-middle leading-none">
      <span
        tabIndex={0}
        role="img"
        aria-label={`More info: ${text}`}
        title={text}
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-[#e7b894]/40 bg-[#e7b894]/10 text-[#e7b894] outline-none transition hover:bg-[#e7b894]/25 focus:bg-[#e7b894]/25"
      >
        <svg
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
          className="h-full w-full"
          fill="currentColor"
          aria-hidden
        >
          <text
            x="8"
            y="8"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="11"
            fontWeight="700"
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            ?
          </text>
        </svg>
      </span>
      <span
        role="tooltip"
        className={[
          "pointer-events-none absolute z-10 w-64 rounded-xl border border-white/10 bg-[#1b0f1e] px-3 py-2.5 text-[11px] font-normal normal-case leading-relaxed tracking-normal text-[#d9c9bc] shadow-lg",
          "opacity-0 transition-opacity duration-150 group-hover/info:opacity-100 group-focus-within/info:opacity-100",
          position === "right"
            ? "left-full top-1/2 ml-2 -translate-y-1/2"
            : position === "left"
              ? "right-full top-1/2 mr-2 -translate-y-1/2"
              : position === "bottom"
                ? "left-1/2 top-full mt-2 -translate-x-1/2"
                : "bottom-full left-1/2 mb-2 -translate-x-1/2",
        ].join(" ")}
      >
        {text}
      </span>
    </span>
  );
}
