# WhaleRadar

Multi-chain whale & smart-money tracking platform: on-chain listener (Go), analytics/scoring
engine (PostgreSQL + Redis), interactive Telegram signal bot (TypeScript) and a Next.js
dashboard / admin panel.

Chains: Ethereum (1), BNB Smart Chain (56), Polygon (137), Arbitrum One (42161).

```
kripto/
├── apps/
│   ├── listener/     Go: listener, scorer, api binaries
│   ├── bot/          TypeScript Telegram bot (Telegraf)
│   └── dashboard/    Next.js 15 + Tailwind dashboard & admin panel
├── db/migrations/    PostgreSQL schema + wallet tag seeds
└── docker-compose.yml
```

## Windows'ta hızlı kurulum (Docker Desktop)

1. Docker Desktop kur ve çalıştır: https://www.docker.com/products/docker-desktop/
2. Zip'i `C:\Users\Gorkempc\Desktop\kripto` içine aç.
3. PowerShell:

```powershell
cd C:\Users\Gorkempc\Desktop\kripto
copy .env.example .env
notepad .env          # RPC URL'lerini ve Telegram token'ını gir
docker compose up --build
```

4. Aç: dashboard http://localhost:3000 · API http://localhost:8080/health

Varsayılan `docker compose up` şunları başlatır: Postgres, Redis, API, scorer, dashboard.
Zincir dinleyicisi ve bot ayrı profillerde (gerçek kimlik bilgileri gerektirdiği için):

```powershell
docker compose --profile live up -d listener     # RPC WS/HTTP gerekli
docker compose --profile bot  up -d bot          # TELEGRAM_BOT_TOKEN gerekli
```

RPC anahtarların yokken arayüzü denemek için örnek veri yükleyebilirsin:

```powershell
Get-Content db\demo_seed.sql | docker compose exec -T postgres psql -U whaleradar -d whaleradar
docker compose restart scorer
```

Migration'lar Postgres ilk açılışta `db/migrations` içinden otomatik uygulanır. Şemayı
sıfırlamak için: `docker compose down -v`.

## Konfigürasyon

Tüm ayarlar `.env` üzerinden (`.env.example` içinde açıklamalı liste). Kritik olanlar:

| Değişken | Açıklama |
| --- | --- |
| `ETH_WS_URL` / `ETH_HTTP_URL` (+ `BSC_`, `POLYGON_`, `ARBITRUM_`) | Zincir RPC uçları. WS log aboneliği, HTTP kontrat çağrıları için. |
| `ENABLED_CHAINS` | Çalıştırılacak chain ID listesi. |
| `MIN_USD` | Bu değerin altındaki transferler ingest'te atılır (varsayılan $50k). |
| `ALERT_USD` | Anlık alert eşiği (varsayılan $100k). |
| `FREE_CHANNEL_USD` / `FREE_DELAY_SECONDS` | Free kanalın eşiği ve gecikmesi. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_VIP_CHANNEL_ID`, `TELEGRAM_FREE_CHANNEL_ID`, `TELEGRAM_ADMIN_IDS` | Bot kimlik bilgileri. |
| `ADMIN_API_KEY` | `/api/admin/*` uçları ve dashboard admin sayfası için. |

Ücretsiz WS sağlayıcıları çoğu zaman `eth_subscribe` desteklemez; Alchemy / QuickNode /
Ankr gibi bir sağlayıcı önerilir.

## Mimari

**Listener (`apps/listener/cmd/listener`)** — her zincir için WS aboneliği: ERC-20
`Transfer`, V2 `PairCreated`, V3 `PoolCreated`. Kopan bağlantı exponential backoff + jitter
ile yeniden bağlanır ve kaçan bloklar backfill edilir. Yeni keşfedilen pool'lar filtreye ve
`dex_pool` etiketine canlı olarak eklenir.

**Pricing (`internal/pricing`)** — token decimals'ı on-chain okur (18/8/6 fark etmez),
USD fiyatını stablecoin ve wrapped-native rotaları üzerinden V2 `getReserves()` ve V3
`slot0()` ile hesaplar, en derin likiditeli rotayı seçer. Sonuçlar Redis'te 60 sn cache'lenir.

**Tagging (`internal/tagging`)** — Binance / Coinbase / Kraken / Wintermute hot wallet'ları,
DEX pool'ları, bridge ve burn adresleri. Transfer yönü buradan türetilir: `cex_deposit`,
`cex_withdrawal`, `dex_buy`, `dex_sell`, `mint`, `burn`, `wallet_transfer`.

**Scorer (`cmd/scorer`)** — 24 saatlik pencerede 0–100 accumulation skoru: net DEX alımı ve
net CEX çekimi (%60), büyüklük (%25), alıcı çeşitliliği (%15). Skor 80'i aşınca alert.

**API (`cmd/api`)** — `/health`, `/api/chains|stats|transfers|scores|pools|alerts` ve
`X-Admin-Key` ile korunan `/api/admin/users|tier|tags`.

**Bot (`apps/bot`)** — Redis `whaleradar:alerts` kanalını dinler; VIP kanal ve VIP DM'leri
anında, free kanal sadece büyük işlemleri gecikmeli alır. Komutlar: `/start`, `/help`,
`/status`, `/top`, `/token`, `/wallet`, `/watch`, `/unwatch`, `/list`, `/threshold`, `/mute`,
`/unmute`, `/vip`, `/paid`, `/myid` — admin: `/grant`, `/revoke`, `/broadcast`, `/stats`.

**Dashboard (`apps/dashboard`)** — Overview, Whale Feed, Accumulation, New Pools, Admin.

## Docker'sız geliştirme

```bash
# Go servisleri
cd apps/listener && go run ./cmd/api      # veya ./cmd/listener, ./cmd/scorer

# Bot
cd apps/bot && npm install && npm run dev

# Dashboard
cd apps/dashboard && npm install && npm run dev
```

Testler ve statik kontroller:

```bash
cd apps/listener && go vet ./... && go test ./...
cd apps/bot       && npm run typecheck && npm run lint
cd apps/dashboard && npm run lint && npm run build
```

## Notlar

- `.env` asla commit edilmemeli; sadece `.env.example` paylaşılır.
- VIP ödeme akışı (`/vip`, `/paid`) on-chain ödeme adresine yapılan transferi talep eder;
  ödeme sağlayıcısı/fiyatlandırma kararı verildiğinde `apps/bot/src/index.ts` içinde
  güncellenmelidir.
