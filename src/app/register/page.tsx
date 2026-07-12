"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const res = await fetch("/api/auth/register", {
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
      setError(data.error ?? "Registration failed");
      return;
    }

    router.push("/kyc");
    router.refresh();
  }

  return (
    <main className="shell" style={{ padding: "3rem 0" }}>
      <div className="card" style={{ maxWidth: 460, margin: "0 auto" }}>
        <h1 style={{ marginTop: 0 }}>Регистрация</h1>
        <p className="muted">Создайте аккаунт, затем пройдите ручную KYC.</p>
        <form onSubmit={onSubmit} style={{ display: "grid", gap: "1rem" }}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required />
          </div>
          <div className="field">
            <label htmlFor="password">
              Пароль (мин. 12, A–Z, a–z и цифра)
            </label>
            <input
              id="password"
              name="password"
              type="password"
              minLength={12}
              required
            />
          </div>
          {error ? (
            <p style={{ color: "var(--danger)", margin: 0 }}>{error}</p>
          ) : null}
          <button className="btn" type="submit" disabled={loading}>
            {loading ? "Создаём…" : "Зарегистрироваться"}
          </button>
        </form>
        <p className="muted" style={{ marginBottom: 0 }}>
          Уже есть аккаунт? <Link href="/login">Войти</Link>
        </p>
      </div>
    </main>
  );
}
