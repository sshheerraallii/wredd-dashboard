// app/(protected)/app/performance/_components/pagination.tsx
import Link from "next/link";

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export function PaginationNav({
  page,
  totalPages,
  hrefForPage,
}: {
  page: number;
  totalPages: number;
  hrefForPage: (p: number) => string;
}) {
  if (totalPages <= 1) return null;

  const p = clamp(page, 1, totalPages);

  const window = 2;
  const start = Math.max(1, p - window);
  const end = Math.min(totalPages, p + window);

  const nums: number[] = [];
  for (let i = start; i <= end; i++) nums.push(i);

  return (
    <div className="mt-4 flex items-center justify-between gap-3">
      <div className="text-xs text-muted-foreground">
        Page {p} of {totalPages}
      </div>

      <div className="flex items-center gap-1">
        <Link
          className={[
            "px-3 py-1 rounded-md border text-sm",
            p === 1 ? "pointer-events-none opacity-50" : "hover:bg-muted",
          ].join(" ")}
          href={hrefForPage(p - 1)}
        >
          Prev
        </Link>

        {start > 1 ? (
          <>
            <Link
              className="px-3 py-1 rounded-md border text-sm hover:bg-muted"
              href={hrefForPage(1)}
            >
              1
            </Link>
            <span className="px-2 text-muted-foreground">…</span>
          </>
        ) : null}

        {nums.map((n) => (
          <Link
            key={n}
            className={[
              "px-3 py-1 rounded-md border text-sm",
              n === p
                ? "bg-primary text-primary-foreground border-primary"
                : "hover:bg-muted",
            ].join(" ")}
            href={hrefForPage(n)}
          >
            {n}
          </Link>
        ))}

        {end < totalPages ? (
          <>
            <span className="px-2 text-muted-foreground">…</span>
            <Link
              className="px-3 py-1 rounded-md border text-sm hover:bg-muted"
              href={hrefForPage(totalPages)}
            >
              {totalPages}
            </Link>
          </>
        ) : null}

        <Link
          className={[
            "px-3 py-1 rounded-md border text-sm",
            p === totalPages ? "pointer-events-none opacity-50" : "hover:bg-muted",
          ].join(" ")}
          href={hrefForPage(p + 1)}
        >
          Next
        </Link>
      </div>
    </div>
  );
}
