"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Login failed");
      return;
    }

    router.push(data.user?.role === "ADMIN" ? "/admin/kyc" : "/dashboard");
    router.refresh();
  }

  return (
    <main className="shell" style={{ padding: "3rem 0" }}>
      <div className="card" style={{ maxWidth: 460, margin: "0 auto" }}>
        <h1 style={{ marginTop: 0 }}>Вход</h1>
        <form onSubmit={onSubmit} style={{ display: "grid", gap: "1rem" }}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required />
          </div>
          <div className="field">
            <label htmlFor="password">Пароль</label>
            <input id="password" name="password" type="password" required />
          </div>
          {error ? (
            <p style={{ color: "var(--danger)", margin: 0 }}>{error}</p>
          ) : null}
          <button className="btn" type="submit" disabled={loading}>
            {loading ? "Входим…" : "Войти"}
          </button>
        </form>
        <p className="muted" style={{ marginBottom: 0 }}>
          Нет аккаунта? <Link href="/register">Регистрация</Link>
        </p>
      </div>
    </main>
  );
}
