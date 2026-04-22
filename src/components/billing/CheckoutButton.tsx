"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

interface Props {
  plan: "pro" | "premium";
  label: string;
  className?: string;
}

export function CheckoutButton({ plan, label, className = "" }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "结账失败");
      window.location.href = data.url;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "未知错误");
      setLoading(false);
    }
  }

  return (
    <div className="w-full">
      <button
        onClick={handleClick}
        disabled={loading}
        className={`flex w-full items-center justify-center gap-2 disabled:opacity-60 ${className}`}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {loading ? "跳转中…" : label}
      </button>
      {error && (
        <p className="mt-2 text-center text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
