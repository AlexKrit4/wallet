"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LogoutButton } from "@/components/logout-button";

type Overview = {
  hotWallet: {
    address: string;
    usdt: string | null;
    bnb: string | null;
    error?: string;
  };
  workers: Array<{
    name: string;
    status: string;
    lastSeenAt: string;
  }>;
  users: Array<{
    id: string;
    email: string;
    role: string;
    kycStatus: string;
    isFrozen: boolean;
    createdAt: string;
    wallet: { address: string } | null;
    balance: { available: string; locked: string } | null;
  }>;
  transactions: Array<{
    id: string;
    type: string;
    status: string;
    amount: string;
    fee: string;
    txHash: string | null;
    createdAt: string;
    user: { email: string };
  }>;
};

export default function AdminPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/overview");
    const body = await response.json();
    if (!response.ok) {
      setError(body.error ?? "Failed to load admin overview");
      return;
    }
    setData(body);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function manageWithdrawal(id: string, action: "retry" | "reconcile") {
    const response = await fetch("/api/admin/withdrawals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    const body = await response.json();
    if (!response.ok) setError(body.error ?? "Retry failed");
    else await load();
  }

  return (
    <main className="shell" style={{ padding: "2rem 0 4rem" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
          marginBottom: "1rem",
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>Админ-панель</h1>
          <p className="muted">Пользователи, операции и состояние воркеров</p>
        </div>
        <div style={{ display: "flex", gap: ".5rem" }}>
          <Link className="btn btn-ghost" href="/admin/kyc">
            Очередь KYC
          </Link>
          <Link className="btn btn-ghost" href="/dashboard">
            Кабинет
          </Link>
          <LogoutButton />
        </div>
      </header>

      {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
      {!data ? (
        <p className="muted">Загрузка…</p>
      ) : (
        <>
          <section className="card" style={{ marginBottom: "1rem" }}>
            <h2 style={{ marginTop: 0 }}>Hot wallet</h2>
            <p className="mono">{data.hotWallet.address}</p>
            <p>
              {data.hotWallet.usdt ?? "—"} USDT · {data.hotWallet.bnb ?? "—"} BNB
            </p>
            {data.hotWallet.error ? (
              <p style={{ color: "var(--warning)" }}>{data.hotWallet.error}</p>
            ) : null}
          </section>

          <section className="card" style={{ marginBottom: "1rem" }}>
            <h2 style={{ marginTop: 0 }}>Воркеры</h2>
            {data.workers.length === 0 ? (
              <p className="muted">Heartbeat ещё не получен.</p>
            ) : (
              data.workers.map((worker) => (
                <p key={worker.name}>
                  <span
                    className={`badge ${worker.status === "healthy" ? "ok" : "danger"}`}
                  >
                    {worker.status}
                  </span>{" "}
                  {worker.name} ·{" "}
                  <span className="muted">
                    {new Date(worker.lastSeenAt).toLocaleString()}
                  </span>
                </p>
              ))
            )}
          </section>

          <section className="card" style={{ marginBottom: "1rem" }}>
            <h2 style={{ marginTop: 0 }}>Пользователи</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", textAlign: "left" }}>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>KYC</th>
                    <th>Доступно</th>
                    <th>Locked</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.email}</td>
                      <td>
                        {user.kycStatus}
                        {user.isFrozen ? " · FROZEN" : ""}
                      </td>
                      <td>{user.balance?.available ?? "0"}</td>
                      <td>{user.balance?.locked ?? "0"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2 style={{ marginTop: 0 }}>Последние операции</h2>
            {data.transactions.map((tx) => (
              <div
                key={tx.id}
                style={{
                  borderTop: "1px solid var(--line)",
                  padding: ".75rem 0",
                }}
              >
                <strong>
                  {tx.type} · {tx.amount} USDT · {tx.status}
                </strong>
                <p className="muted" style={{ margin: ".2rem 0" }}>
                  {tx.user.email} · {new Date(tx.createdAt).toLocaleString()}
                </p>
                {tx.status === "FAILED" && tx.type === "WITHDRAWAL" ? (
                  <button
                    className="btn btn-ghost"
                    type="button"
                  onClick={() => manageWithdrawal(tx.id, "retry")}
                  >
                    Повторить вывод
                  </button>
                ) : null}
                {tx.status === "REVIEW" && tx.type === "WITHDRAWAL" ? (
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => manageWithdrawal(tx.id, "reconcile")}
                  >
                    Проверить on-chain и продолжить
                  </button>
                ) : null}
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
