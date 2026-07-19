"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { ApiError, getMe, listCards, getPublicUrl } from "@/lib/api";
import type { Me, AgentCard } from "@/lib/api";
import { clearAuthToken } from "@/lib/auth";
import { useRequireAuth } from "@/hooks/useRequireAuth";

export default function DashboardPage() {
  useRequireAuth();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [cards, setCards] = useState<AgentCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([getMe(), listCards()])
      .then(([meData, cardsData]) => {
        if (cancelled) return;
        setMe(meData);
        setCards(cardsData);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          clearAuthToken();
          router.replace("/login");
        } else {
          setError("Could not load your data. Please try again.");
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [router]);

  function signOut() {
    clearAuthToken();
    router.replace("/");
  }

  async function copyUrl(url: string, cardId: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(cardId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore
    }
  }

  if (loading) {
    return (
      <PageShell title="Dashboard" description="Loading your agent cards…">
        <div className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm text-sm text-slate-400">
          Loading…
        </div>
      </PageShell>
    );
  }

  if (error || !me) {
    return (
      <PageShell title="Dashboard" description="">
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
          {error ?? "Something went wrong."}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Dashboard"
      description={`Signed in as ${me.email}`}
    >
      <div className="space-y-6">
        {/* Profile card */}
        <div className="flex items-center justify-between rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
          <div>
            <p className="font-semibold text-slate-950">{me.display_name ?? me.email}</p>
            <p className="text-sm text-slate-500">{me.email}</p>
            <div className="mt-1 flex items-center gap-2">
              <span className="rounded-full border border-black/10 bg-slate-50 px-2.5 py-0.5 font-mono text-xs text-slate-500">
                {me.identity_type === "domain" ? `domain: ${me.domain}` : "personal (email)"}
              </span>
            </div>
          </div>
          <button
            onClick={signOut}
            className="rounded-2xl border border-black/10 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>

        {/* Agent cards */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
              Agent Cards
            </h2>
            <Link
              href="/dashboard/cards/new"
              className="rounded-full border border-black/10 bg-white px-4 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              + New card
            </Link>
          </div>

          {cards.length === 0 ? (
            <div className="rounded-3xl border border-black/10 bg-white p-8 shadow-sm text-center">
              <p className="text-sm text-slate-400">
                You have no agent cards yet.{" "}
                <Link href="/dashboard/cards/new" className="text-slate-700 underline hover:text-slate-950">
                  Create your first card
                </Link>
                .
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {cards.map((card) => {
                const publicUrl = getPublicUrl(
                  me.identity_type,
                  me.identity_type === "domain" ? (me.domain ?? me.email) : me.email,
                  card.slug
                );

                return (
                  <div
                    key={card.id}
                    className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-slate-950">{card.display_name}</p>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] ${
                            card.status === "active"
                              ? "border border-emerald-200 bg-emerald-50 text-emerald-600"
                              : "border border-slate-200 bg-slate-50 text-slate-500"
                          }`}>
                            {card.status}
                          </span>
                        </div>
                        <p className="font-mono text-xs text-slate-400">/{card.slug}</p>
                        {card.description && (
                          <p className="mt-1 text-sm text-slate-500 line-clamp-1">{card.description}</p>
                        )}

                        {/* Public URL */}
                        <div className="mt-3 flex items-center gap-2">
                          <code className="min-w-0 flex-1 truncate rounded-lg border border-black/5 bg-slate-50 px-3 py-1.5 font-mono text-xs text-slate-600">
                            {publicUrl}
                          </code>
                          <button
                            onClick={() => copyUrl(publicUrl, card.id)}
                            className="shrink-0 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                          >
                            {copiedId === card.id ? "Copied!" : "Copy"}
                          </button>
                        </div>
                      </div>

                      <Link
                        href={`/dashboard/cards/${card.id}`}
                        className="shrink-0 rounded-xl border border-black/10 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                      >
                        Edit
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
