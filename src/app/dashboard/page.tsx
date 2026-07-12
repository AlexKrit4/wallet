import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LogoutButton } from "@/components/logout-button";
import { CopyButton } from "@/components/copy-button";
import { WithdrawForm } from "@/components/withdraw-form";

function statusBadge(status: string) {
  if (status === "COMPLETED" || status === "APPROVED") return "badge ok";
  if (status === "PENDING" || status === "CONFIRMING") return "badge warn";
  if (status === "FAILED" || status === "REJECTED") return "badge danger";
  return "badge";
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.id },
    include: {
      wallet: true,
      balance: true,
      transactions: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });

  return (
    <main className="shell" style={{ padding: "2rem 0 4rem" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "1rem",
          alignItems: "center",
          marginBottom: "1.5rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <strong>Кабинет</strong>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            {user.email}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {user.role === "ADMIN" ? (
            <Link className="btn btn-ghost" href="/admin">
              Админка
            </Link>
          ) : null}
          <Link className="btn btn-ghost" href="/kyc">
            KYC
          </Link>
          <LogoutButton />
        </div>
      </header>

      {user.isFrozen ? (
        <section className="card" style={{ marginBottom: "1rem" }}>
          <strong style={{ color: "var(--danger)" }}>
            Аккаунт заморожен для ручной проверки
          </strong>
          <p className="muted" style={{ marginBottom: 0 }}>
            Выводы отключены. Обратитесь к администратору.
          </p>
        </section>
      ) : null}

      <div
        style={{
          display: "grid",
          gap: "1rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          marginBottom: "1rem",
        }}
      >
        <section className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            Баланс USDT
          </p>
          <h2 style={{ margin: 0, fontSize: "2rem" }}>
            {user.balance?.available.toString() ?? "0"}
          </h2>
          <p className="muted" style={{ marginBottom: 0 }}>
            В холде: {user.balance?.locked.toString() ?? "0"}
          </p>
        </section>

        <section className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            Статус KYC
          </p>
          <span className={statusBadge(user.kycStatus)}>{user.kycStatus}</span>
          {user.kycStatus !== "APPROVED" ? (
            <p className="muted" style={{ marginBottom: 0, marginTop: "0.8rem" }}>
              Адрес депозита появится после одобрения.{" "}
              <Link href="/kyc">Пройти верификацию</Link>
            </p>
          ) : (
            <p className="muted" style={{ marginBottom: 0, marginTop: "0.8rem" }}>
              Сеть: BSC · токен: USDT (BEP-20)
            </p>
          )}
        </section>
      </div>

      {user.wallet ? (
        <section className="card" style={{ marginBottom: "1rem" }}>
          <h3 style={{ marginTop: 0 }}>Адрес для депозита</h3>
          <p className="mono">{user.wallet.address}</p>
          <CopyButton value={user.wallet.address} />
          <p className="muted" style={{ marginBottom: 0 }}>
            Отправляйте только USDT в сети BNB Smart Chain (BEP-20). Другие
            сети/токены будут потеряны.
          </p>
        </section>
      ) : null}

      {user.kycStatus === "APPROVED" && !user.isFrozen ? (
        <section className="card" style={{ marginBottom: "1rem" }}>
          <h3 style={{ marginTop: 0 }}>Вывод USDT</h3>
          <WithdrawForm />
        </section>
      ) : null}

      <section className="card">
        <h3 style={{ marginTop: 0 }}>История</h3>
        {user.transactions.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            Пока нет операций.
          </p>
        ) : (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {user.transactions.map((tx) => (
              <div
                key={tx.id}
                style={{
                  display: "grid",
                  gap: "0.25rem",
                  borderTop: "1px solid var(--line)",
                  paddingTop: "0.75rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.75rem",
                    flexWrap: "wrap",
                  }}
                >
                  <strong>
                    {tx.type} · {tx.amount.toString()} USDT
                  </strong>
                  <span className={statusBadge(tx.status)}>{tx.status}</span>
                </div>
                <p className="muted" style={{ margin: 0 }}>
                  {new Date(tx.createdAt).toLocaleString()}
                </p>
                {tx.txHash ? (
                  <a
                    className="mono muted"
                    href={`https://bscscan.com/tx/${tx.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {tx.txHash}
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
