"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || "Unexpected response" };
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "Login failed");
      setLoading(false);
      return;
    }

    if (data.role === "DOCTOR") {
      router.push("/doctor");
    } else {
      router.push("/patient");
    }
  }

  return (
    <div className="min-h-screen">
      <div className="grid-dots" />
      <div className="container-shell page-shell">
        <header className="app-header fade-up">
          <div>
            <p className="eyebrow">GOJO Health App</p>
            <h1 className="text-3xl font-semibold mt-2">Secure sign in</h1>
            <p className="subtle text-sm mt-2">Doctors and patients use the same login entry and then land in their own workspaces.</p>
          </div>
          <div className="app-header__cluster">
            <ThemeToggle />
            <Link className="btn-secondary" href="/">
              Home
            </Link>
          </div>
        </header>

        <div className="max-w-xl mx-auto card-contrast fade-up" style={{ animationDelay: "120ms" }}>
          <span className="badge">Secure access</span>
          <h1 className="text-4xl font-semibold mt-4">Welcome back</h1>
          <p className="subtle mt-3 text-base">
            Sign in to access your workspace. The refreshed UI keeps the experience lighter and more legible across both themes.
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <div>
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@hospital.org"
                required
              />
            </div>
            <div>
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            {error && <p className="text-[var(--danger)] text-sm">{error}</p>}

            <button className="btn-primary w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <p className="subtle mt-5 text-sm">
            New here? <Link className="text-[var(--accent)]" href="/register">Create an account</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
