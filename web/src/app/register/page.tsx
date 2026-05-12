"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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

export default function RegisterPage() {
  const router = useRouter();
  const params = useSearchParams();
  const presetRole = params.get("role");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"DOCTOR" | "PATIENT">(
    presetRole === "DOCTOR" ? "DOCTOR" : "PATIENT"
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, role }),
    });

    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "Registration failed");
      setLoading(false);
      return;
    }

    if (role === "DOCTOR") {
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
            <h1 className="text-3xl font-semibold mt-2">Create your account</h1>
            <p className="subtle text-sm mt-2">Choose the role you want so we can route you into the right workspace from the start.</p>
          </div>
          <div className="app-header__cluster">
            <ThemeToggle />
            <Link className="btn-secondary" href="/">
              Home
            </Link>
          </div>
        </header>

        <div className="max-w-xl mx-auto card-contrast fade-up" style={{ animationDelay: "120ms" }}>
          <span className="badge">Role‑based access</span>
          <h1 className="text-4xl font-semibold mt-4">Create your account</h1>
          <p className="subtle mt-3 text-base">
            Choose your role to unlock the tailored assistant, dashboards, and future settings persistence.
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <div>
              <label>Full name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Jordan Lee" />
            </div>
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
                placeholder="At least 8 characters"
                required
              />
            </div>
            <div>
              <label>Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value as "DOCTOR" | "PATIENT")}> 
                <option value="DOCTOR">Doctor</option>
                <option value="PATIENT">Patient</option>
              </select>
            </div>

            {error && <p className="text-[var(--danger)] text-sm">{error}</p>}

            <button className="btn-primary w-full" disabled={loading}>
              {loading ? "Creating..." : "Create Account"}
            </button>
          </form>

          <p className="subtle mt-5 text-sm">
            Already have an account? <Link className="text-[var(--accent)]" href="/login">Sign in</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
