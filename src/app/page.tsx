import Link from "next/link";
import { getSession } from "@/lib/auth";

export default async function HomePage() {
  const user = await getSession();

  return (
    <main className="shell" style={{ padding: "2.5rem 0 4rem" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "3rem",
        }}
      >
        <strong style={{ letterSpacing: "0.04em" }}>BSC USDT Wallet</strong>
        <nav style={{ display: "flex", gap: "0.75rem" }}>
          {user ? (
            <Link className="btn" href="/dashboard">
              Кабинет
            </Link>
          ) : (
            <>
              <Link className="btn btn-ghost" href="/login">
                Вход
              </Link>
              <Link className="btn" href="/register">
                Регистрация
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="card" style={{ padding: "2rem" }}>
        <p className="muted" style={{ marginTop: 0 }}>
          MVP · BNB Smart Chain
        </p>
        <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.2rem)", margin: "0.4rem 0" }}>
          Простой кастодиальный кошелёк USDT (BEP-20)
        </h1>
        <p className="muted" style={{ maxWidth: "42rem", lineHeight: 1.6 }}>
          Регистрация, ручная верификация, персональный адрес для депозитов и
          вывод USDT. Старт с одной сети — BSC.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
          <Link className="btn" href={user ? "/dashboard" : "/register"}>
            {user ? "Открыть кабинет" : "Создать аккаунт"}
          </Link>
          <Link className="btn btn-ghost" href="/login">
            Уже есть аккаунт
          </Link>
        </div>
      </section>
    </main>
  );
}
