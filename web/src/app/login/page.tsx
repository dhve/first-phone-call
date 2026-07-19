"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { ApiError, registerUser, loginUser } from "@/lib/api";
import { setAuthToken, getAuthToken, isTokenExpired } from "@/lib/auth";

type Mode = "login" | "register";
type IdentityType = "email" | "domain";

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason");

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [identityType, setIdentityType] = useState<IdentityType>("email");
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect if already logged in
  useEffect(() => {
    const token = getAuthToken();
    if (token && !isTokenExpired(token)) {
      router.replace("/dashboard");
    }
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      let token: string;
      if (mode === "register") {
        token = await registerUser({
          email,
          password,
          display_name: displayName || undefined,
          identity_type: identityType,
          domain: identityType === "domain" ? domain : undefined,
        });
      } else {
        token = await loginUser(email, password);
      }

      setAuthToken(token);
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell
      title={mode === "login" ? "Sign in" : "Create account"}
      description="Manage your A2A agent cards on host39."
    >
      <div className="mx-auto max-w-sm space-y-5">
        {reason === "session_expired" && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
            Your session expired. Please sign in again.
          </p>
        )}

        <div className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm">
          {/* Mode toggle */}
          <div className="mb-5 flex rounded-xl border border-black/10 p-1 text-sm">
            <button
              type="button"
              onClick={() => { setMode("login"); setError(null); }}
              className={`flex-1 rounded-lg py-1.5 font-medium transition ${
                mode === "login" ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => { setMode("register"); setError(null); }}
              className={`flex-1 rounded-lg py-1.5 font-medium transition ${
                mode === "register" ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Create account
            </button>
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            {mode === "register" && (
              <>
                <input
                  type="text"
                  placeholder="Display name (optional)"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full rounded-xl border border-black/10 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-300"
                />

                {/* Identity type */}
                <div className="rounded-xl border border-black/10 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Identity type
                  </p>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="identity_type"
                        value="email"
                        checked={identityType === "email"}
                        onChange={() => setIdentityType("email")}
                        className="accent-slate-950"
                      />
                      <span className="text-sm text-slate-700">Personal (email)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="identity_type"
                        value="domain"
                        checked={identityType === "domain"}
                        onChange={() => setIdentityType("domain")}
                        className="accent-slate-950"
                      />
                      <span className="text-sm text-slate-700">Business (domain)</span>
                    </label>
                  </div>

                  {identityType === "domain" && (
                    <div className="mt-3">
                      <input
                        type="text"
                        placeholder="yourdomain.com"
                        value={domain}
                        onChange={(e) => setDomain(e.target.value)}
                        required={identityType === "domain"}
                        pattern="^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
                        className="w-full rounded-xl border border-black/10 px-4 py-2.5 font-mono text-sm outline-none focus:ring-2 focus:ring-slate-300"
                      />
                      <p className="mt-1.5 text-xs text-slate-400">
                        Your cards will be at /{domain || "yourdomain.com"}/slug.json
                      </p>
                    </div>
                  )}

                  {identityType === "email" && (
                    <p className="mt-2 text-xs text-slate-400">
                      Your cards will be at /personal/email@example.com/slug.json
                    </p>
                  )}
                </div>
              </>
            )}

            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-xl border border-black/10 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-300"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full rounded-xl border border-black/10 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-300"
            />

            {error && (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-slate-950 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {loading ? "…" : mode === "register" ? "Create account" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </PageShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    }>
      <LoginPageInner />
    </Suspense>
  );
}
