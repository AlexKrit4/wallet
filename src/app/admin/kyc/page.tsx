"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogoutButton } from "@/components/logout-button";

type Item = {
  id: string;
  fullName: string;
  documentType: string;
  documentNumber: string;
  country: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
  user: { email: string };
};

export default function AdminKycPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/kyc");
    if (res.status === 401 || res.status === 403) {
      router.push("/login");
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to load");
      return;
    }
    setItems(data.items);
  }, [router]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function review(id: string, action: "approve" | "reject") {
    const adminNote =
      action === "reject"
        ? window.prompt("Причина отклонения (опционально)") ?? undefined
        : undefined;
    setBusyId(id);
    const res = await fetch("/api/admin/kyc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, adminNote }),
    });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) {
      setError(data.error ?? "Action failed");
      return;
    }
    await load();
  }

  return (
    <main className="shell" style={{ padding: "2rem 0 4rem" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.5rem",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>Админ · KYC</h1>
          <p className="muted" style={{ margin: "0.3rem 0 0" }}>
            Ручное одобрение / отклонение
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Link className="btn btn-ghost" href="/dashboard">
            Кабинет
          </Link>
          <LogoutButton />
        </div>
      </header>

      {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}

      <div style={{ display: "grid", gap: "1rem" }}>
        {items.length === 0 ? (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              Заявок пока нет.
            </p>
          </div>
        ) : (
          items.map((item) => (
            <article key={item.id} className="card">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "1rem",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <strong>{item.fullName}</strong>
                  <p className="muted" style={{ margin: "0.25rem 0" }}>
                    {item.user.email}
                  </p>
                </div>
                <span className={`badge ${item.status === "APPROVED" ? "ok" : item.status === "REJECTED" ? "danger" : "warn"}`}>
                  {item.status}
                </span>
              </div>
              <p style={{ margin: "0.4rem 0" }}>
                {item.documentType}: <span className="mono">{item.documentNumber}</span>
              </p>
              {item.country ? <p className="muted">Страна: {item.country}</p> : null}
              {item.notes ? <p className="muted">Заметка: {item.notes}</p> : null}
              <p className="muted">
                Создано: {new Date(item.createdAt).toLocaleString()}
              </p>
              {item.status === "PENDING" ? (
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    className="btn"
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => review(item.id, "approve")}
                  >
                    Одобрить
                  </button>
                  <button
                    className="btn btn-danger"
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => review(item.id, "reject")}
                  >
                    Отклонить
                  </button>
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>
    </main>
  );
}
