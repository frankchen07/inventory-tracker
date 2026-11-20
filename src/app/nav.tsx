import Link from "next/link";

type Section = "buy" | "months";

const ICON = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const LINKS: { href: string; label: string; section: Section | null; icon: React.ReactNode }[] = [
  {
    href: "/",
    label: "Buy list",
    section: "buy",
    icon: (
      <svg {...ICON}>
        <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
      </svg>
    ),
  },
  {
    href: "/month",
    label: "Months",
    section: "months",
    icon: (
      <svg {...ICON}>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    ),
  },
  {
    href: "/production",
    label: "Production",
    section: null,
    icon: (
      <svg {...ICON}>
        <path d="M4 20V10l5 3V10l5 3V6h6v14z" />
      </svg>
    ),
  },
];

// A tab bar fixed to the bottom on phones (thumb reach); a plain top bar on
// laptops. It comes first in the page, so on laptops it sits above the content.
export function Nav({ current }: { current: Section }) {
  return (
    <nav
      aria-label="Pages"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-200 bg-zinc-50 font-sans lg:static lg:border-b lg:border-t-0"
    >
      <div className="mx-auto grid max-w-[1100px] grid-cols-3 lg:flex lg:gap-1 lg:px-4">
        {LINKS.map((link) => {
          const active = link.section === current;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-15 flex-col items-center justify-center gap-0.5 text-xs lg:min-h-14 lg:flex-row lg:gap-2 lg:px-3 lg:text-base ${
                active ? "font-semibold text-zinc-900" : "font-medium text-zinc-600 hover:text-zinc-900"
              }`}
            >
              {link.icon}
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// Page body padding: clears the fixed bottom bar on phones.
export const PAGE = "mx-auto w-full px-4 pt-6 pb-28 font-sans text-zinc-900 tabular-nums lg:pt-8 lg:pb-14";
