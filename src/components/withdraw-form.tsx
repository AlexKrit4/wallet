"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function WithdrawForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setOk(null);

    const form = new FormData(event.currentTarget);
    const res = await fetch("/api/withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: form.get("address"),
        amount: form.get("amount"),
      }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Withdrawal failed");
      return;
    }

    setOk("Заявка на вывод создана и ждёт обработки воркером.");
    event.currentTarget.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: "1rem" }}>
      <div className="field">
        <label htmlFor="address">BSC-адрес получателя</label>
        <input
          id="address"
          name="address"
          className="mono"
          placeholder="0x..."
          required
        />
      </div>
      <div className="field">
        <label htmlFor="amount">Сумма USDT, которую получит адрес</label>
        <input id="amount" name="amount" placeholder="10" required />
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Комиссия сервиса будет добавлена к списанию и показана в истории.
      </p>
      {error ? <p style={{ color: "var(--danger)", margin: 0 }}>{error}</p> : null}
      {ok ? <p style={{ color: "var(--ok)", margin: 0 }}>{ok}</p> : null}
      <button className="btn" type="submit" disabled={loading}>
        {loading ? "Отправка…" : "Вывести"}
      </button>
    </form>
  );
}
