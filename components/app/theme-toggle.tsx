"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { useTheme } from "next-themes";

type Mode = "system" | "light" | "dark";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const mode = (theme ?? "system") as Mode;

  function cycle() {
    const next: Mode =
      mode === "system" ? "light" : mode === "light" ? "dark" : "system";
    setTheme(next);
  }

  const label = mode === "system" ? "auto" : mode;

  return (
    <Button variant="outline" size="sm" onClick={cycle} title="Theme: auto → light → dark">
      Theme: {label}
    </Button>
  );
}
