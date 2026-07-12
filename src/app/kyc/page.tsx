"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type KycState = {
  kycStatus: string;
  submission: { status: string; adminNote?: string | null } | null;
};

export default function KycPage() {
  const router = useRouter();
  const [state, setState] = useState<KycState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/kyc")
      .then(async (res) => {
        if (res.status === 401) {
          router.push("/login");
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data) setState(data);
      });
  }, [router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const res = await fetch("/api/kyc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: form.get("fullName"),
        documentType: form.get("documentType"),
        documentNumber: form.get("documentNumber"),
        country: form.get("country") || undefined,
        notes: form.get("notes") || undefined,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to submit KYC");
      return;
    }
    setState({ kycStatus: "PENDING", submission: data.submission });
  }

  if (!state) {
    return (
      <main className="shell" style={{ padding: "3rem 0" }}>
        <p className="muted">Загрузка…</p>
      </main>
    );
  }

  if (state.kycStatus === "APPROVED") {
    return (
      <main className="shell" style={{ padding: "3rem 0" }}>
        <div className="card">
          <h1 style={{ marginTop: 0 }}>KYC одобрена</h1>
          <p className="muted">Кошелёк уже доступен в кабинете.</p>
          <Link className="btn" href="/dashboard">
            Перейти в кабинет
          </Link>
        </div>
      </main>
    );
  }

  if (state.kycStatus === "PENDING") {
    return (
      <main className="shell" style={{ padding: "3rem 0" }}>
        <div className="card">
          <h1 style={{ marginTop: 0 }}>Заявка на проверке</h1>
          <p className="muted">
            Администратор вручную проверит данные. После одобрения появится
            адрес для депозитов USDT (BEP-20).
          </p>
          <Link className="btn btn-ghost" href="/dashboard">
            В кабинет
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="shell" style={{ padding: "3rem 0" }}>
      <div className="card" style={{ maxWidth: 560, margin: "0 auto" }}>
        <h1 style={{ marginTop: 0 }}>Верификация (ручная)</h1>
        <p className="muted">
          Заполните данные. В MVP документы не загружаются файлами — админ
          проверяет заявку вручную.
        </p>
        {state.kycStatus === "REJECTED" ? (
          <p style={{ color: "var(--danger)" }}>
            Предыдущая заявка отклонена
            {state.submission?.adminNote
              ? `: ${state.submission.adminNote}`
              : "."}{" "}
            Можно отправить снова.
          </p>
        ) : null}
        <form onSubmit={onSubmit} style={{ display: "grid", gap: "1rem" }}>
          <div className="field">
            <label htmlFor="fullName">ФИО</label>
            <input id="fullName" name="fullName" required />
          </div>
          <div className="field">
            <label htmlFor="documentType">Тип документа</label>
            <select id="documentType" name="documentType" required>
              <option value="passport">Паспорт</option>
              <option value="id_card">ID-карта</option>
              <option value="driver_license">Водительские права</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="documentNumber">Номер документа</label>
            <input id="documentNumber" name="documentNumber" required />
          </div>
          <div className="field">
            <label htmlFor="country">Страна</label>
            <input id="country" name="country" placeholder="например UA" />
          </div>
          <div className="field">
            <label htmlFor="notes">Комментарий</label>
            <textarea id="notes" name="notes" rows={3} />
          </div>
          {error ? (
            <p style={{ color: "var(--danger)", margin: 0 }}>{error}</p>
          ) : null}
          <button className="btn" type="submit" disabled={loading}>
            {loading ? "Отправка…" : "Отправить на проверку"}
          </button>
        </form>
      </div>
    </main>
  );
}
