"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";

export function SearchParamsToaster() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const ok  = searchParams.get("ok");
    const err = searchParams.get("err");

    if (!ok && !err) return;

    if (ok)  toast.success(decodeURIComponent(ok));
    if (err) toast.error(decodeURIComponent(err));

    // Clean the URL — remove ok/err params without re-rendering
    const params = new URLSearchParams(searchParams.toString());
    params.delete("ok");
    params.delete("err");

    const newUrl = params.size > 0
      ? `${pathname}?${params.toString()}`
      : pathname;

    router.replace(newUrl, { scroll: false });
  }, [searchParams, pathname, router]);

  return null;
}