"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname } from "next/navigation";

export function NavProgress() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);
  const [prevPath, setPrevPath] = useState(pathname);

  useEffect(() => {
    if (pathname !== prevPath) {
      setLoading(false);
      setPrevPath(pathname);
    }
  }, [pathname, prevPath]);

  // Intercept all link clicks to show loading bar
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const link = (e.target as HTMLElement).closest("a[href]");
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("http")) return;
      if (href === pathname) return;
      setLoading(true);
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [pathname]);

  if (!loading) return null;

  return <div className="page-loading-bar" />;
}
