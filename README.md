# BSC USDT Wallet

Кастодиальный кошелёк USDT (BEP-20): регистрация, ручная KYC, отдельные
HD-адреса депозитов, внутренний ledger, выводы через hot wallet и автоматический
sweeper. Разворачивается на Ubuntu VPS через Docker Compose и Caddy.

> Это не лицензированный банковский продукт. Кастодиальная модель означает, что
> компрометация VPS, `.env`, `MASTER_MNEMONIC` или hot wallet ведёт к потере
> средств. Начинайте только с 1–2 USDT. До публичного запуска нужны независимый
> security-аудит, юридическая оценка KYC/AML и план реагирования на инциденты.

## Сервисы

- `web` — Next.js 16, API и интерфейс
- `postgres` — балансы, неизменяемые ledger entries, транзакции и аудит
- `redis` — rate limits и распределённые блокировки
- `deposit-worker` — подтверждённые Transfer USDT → ledger credit
- `withdrawal-worker` — резервирование → on-chain transfer → settlement/refund
- `sweeper` — BNB gas top-up и перевод USDT с deposit address в hot wallet
- `caddy` — HTTPS Let's Encrypt и security headers

Контракт BSC USDT: `0x55d398326f99059fF775485246999027B3197955`,
chain ID `56`, decimals `18`.

## Деплой на чистый Ubuntu VPS

Требования: Ubuntu 22.04/24.04, домен с A/AAAA на VPS, открытые TCP 80/443,
минимум 2 CPU / 4 GB RAM / 30 GB SSD.

```bash
sudo apt-get update
sudo apt-get install -y git
git clone YOUR_REPOSITORY_URL /opt/bsc-usdt-wallet
cd /opt/bsc-usdt-wallet
sudo cp .env.example .env
sudo nano .env
sudo chmod 600 .env
sudo bash scripts/bootstrap-vps.sh
```

Сначала можно вызвать bootstrap без `.env`: он создаст шаблон и остановится.
Повторный запуск валидирует отсутствие placeholder-значений, соберёт образ,
применит `prisma migrate deploy`, создаст/обновит администратора и поднимет стек.

### Обязательные значения `.env`

1. `DOMAIN`, `APP_URL`, `ACME_EMAIL`
2. `POSTGRES_PASSWORD`, согласованный `DATABASE_URL`
3. `REDIS_PASSWORD`, согласованный `REDIS_URL`
4. `AUTH_SECRET` (`openssl rand -base64 48`)
5. `MASTER_MNEMONIC` и `HOT_WALLET_PRIVATE_KEY`
6. надёжный `BSC_RPC_URL` и сильный `ADMIN_PASSWORD`

Mnemonic генерируйте офлайн:

```bash
npm ci
npm run wallet:mnemonic
```

Не используйте тестовую mnemonic, не отправляйте её в чат и не храните в Git.
Сделайте две офлайн-копии. Hot wallet должен быть отдельным от mnemonic.

## Проверка реальными 1–2 USDT

1. Откройте `https://DOMAIN`, зарегистрируйте пользователя и отправьте KYC.
2. Войдите администратором, откройте `/admin/kyc`, одобрите заявку.
3. В кабинете пользователя скопируйте BSC deposit address.
4. Отправьте на него **только USDT BEP-20**. Не используйте ERC-20/TRC-20.
5. После 12 подтверждений `deposit-worker` создаст deposit transaction,
   ledger credit и увеличит available balance.
6. Заранее положите в hot wallet немного BNB и USDT. Создайте вывод на внешний
   BSC-адрес. Сумма списывается в locked атомарно.
7. `withdrawal-worker` отправит `netAmount`, сохранит hash и после receipt
   уменьшит locked. Ссылка BscScan появится в истории.
8. `sweeper` подольёт BNB на deposit address при необходимости и переведёт
   лежащие там USDT в hot wallet.

Комиссия сервиса (`WITHDRAW_FEE`) добавляется к сумме, которую получает
пользователь: при выводе 1 USDT и fee 0.1 с внутреннего баланса резервируется
1.1 USDT.

## Диагностика

```bash
docker compose ps
docker compose logs -f web
docker compose logs -f deposit-worker
docker compose logs -f withdrawal-worker
docker compose logs -f sweeper
docker compose logs -f caddy
curl -fsS https://DOMAIN/api/health
```

В `/admin` видны heartbeat воркеров, пользователи, балансы, операции и
read-only баланс hot wallet. Для failed withdrawal доступен retry; повторно
резервируется актуальный баланс пользователя.

Ищите в логах:

- deposit: `scanned ... credited=N`
- withdrawal: `broadcast` затем `confirmed`
- sweeper: `swept ... tx=`
- Caddy: успешное получение TLS-сертификата

## Backup и восстановление

Ручной backup:

```bash
sudo bash scripts/backup-postgres.sh
```

Cron ежедневно в 03:15:

```cron
15 3 * * * cd /opt/bsc-usdt-wallet && bash scripts/backup-postgres.sh >> /var/log/wallet-backup.log 2>&1
```

Храните зашифрованную копию вне VPS. Восстановление:

```bash
cat backups/wallet-TIMESTAMP.dump | \
  docker compose exec -T postgres sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists'
```

Mnemonic в backup БД не входит — её резервная копия обязательна отдельно.

## Обновление

```bash
cd /opt/bsc-usdt-wallet
git pull --ff-only
sudo docker compose build --pull
sudo docker compose run --rm migrate
sudo docker compose up -d
sudo docker compose ps
```

## Реализованные меры

- PostgreSQL `DECIMAL(36,18)`, non-negative CHECK constraints
- атомарное reserve/locked/refund и immutable ledger references
- идемпотентность deposit по `(chainId, txHash, logIndex)`
- 12 confirmations, block cursor/hash и rollback при reorg
- Redis locks для singleton workers и сериализации nonce hot wallet
- retry RPC с exponential backoff
- httpOnly Secure `__Host-session`, SameSite=Lax и Origin check
- Redis rate limits для регистрации, входа и вывода
- daily withdrawal limit, minimum и fee
- audit logs для auth, KYC и withdrawals
- секреты исключены из Git и Docker build context

## До работы с крупными суммами

HSM/KMS для ключей, 2FA/WebAuthn, withdrawal allowlist/cooldown, полноценный
AML-провайдер, мониторинг/алерты, encrypted backups, SAST/DAST, dependency
scanning, внешний аудит smart-contract/RPC edge cases и обязательная ручная
проверка крупных выводов.
