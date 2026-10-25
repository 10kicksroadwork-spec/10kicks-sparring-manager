"use client";

import { useEffect } from "react";
import { api } from "@/components/common/client";

export default function HomePage() {
  useEffect(() => {
    void api("/api/bootstrap").then((result) => {
      window.location.href = result.ok ? "/dashboard" : "/signin";
    });
  }, []);
  return <p className="p-6 text-[var(--muted)]">Opening the gym desk…</p>;
}
