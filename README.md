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
| `FREE_CHANNEL_MIN_USD` / `ALERT_USD` | Free kanal bandı `$50k–$100k`, VIP kanal `$100k+`. |
| `FREE_DELAY_SECONDS` | Free kanal gönderimine opsiyonel gecikme (0 = anında). |
| `LIMIT_STABLE_*`, `LIMIT_MAJOR_*`, `LIMIT_TOKEN_*` | Yayın eşikleri (Whale Alert'in kademeleriyle aynı mantık, onda biri büyüklükte): stablecoin bilinen $10M / bilinmeyen $20M / mint-burn $100M, sarmalanmış native (WETH, WBNB, WPOL) $5M / $10M, diğer ERC-20 $2M / $5M. "Bilinen", en az bir tarafın etiketli (borsa, havuz, fon) olması demek. Eşiğin altındaki her şey yine kaydedilir ve dashboard'da görünür, sadece kanallara gitmez. |
| `CHANNEL_INTERVAL_MS` / `CHANNEL_QUEUE_SIZE` | Kanal başına mesaj aralığı ve kuyruk derinliği (Telegram ~20 mesaj/dk sınırı). |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_VIP_CHANNEL_ID`, `TELEGRAM_FREE_CHANNEL_ID`, `TELEGRAM_ADMIN_IDS` | Bot kimlik bilgileri. |
| `ADMIN_API_KEY` | `/api/admin/*` uçları ve dashboard admin sayfası için. |
| `DATA_RETENTION` | Ham transfer/score geçmişi bu süreden eskiyse saatlik olarak silinir (varsayılan 30 gün, `0` = kapalı). Alert performans kayıtları ve cüzdan skorları silinmez. |
| `VIP_PRICE_USD` / `VIP_PLAN_DAYS` | VIP abonelik fiyatı (varsayılan `9.99`) ve süresi (30 gün). |
| `PAYMENT_NETWORK` / `PAYMENT_ADDRESS` | USDT tahsilat ağı (`tron`, `bsc`, `ethereum`, `polygon`, `arbitrum`) ve alıcı adres. Adres boşsa ödeme akışı kapalı görünür. |
| `INVOICE_TTL` | Ödeme talebinin geçerlilik süresi (varsayılan 45 dk). |
| `TRONGRID_API_KEY` | Opsiyonel; TRON ağında TronGrid rate limitini yükseltir. |
| `NEXT_PUBLIC_TELEGRAM_BOT` | Telegram Login Widget'ın kullandığı bot kullanıcı adı (`@` olmadan). |

`.env.example` içindeki `publicnode.com` uçları ücretsizdir ve `eth_subscribe` destekler
(4 zincirde de test edildi). Yoğun kullanımda Alchemy / QuickNode gibi bir sağlayıcıya
geçmek daha stabildir.

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

**Analytics (`internal/store/analytics.go`)** — `/api/analytics?hours=&chain_id=&min_usd=`
seçilen pencerede saatlik/günlük kovalara toplanmış balina hacmi, alım baskısı (borsa çıkışı
+ DEX alımı) ile satış baskısı (borsa girişi + DEX satışı) ayrımı, en yüksek hacimli 8 varlık
ve zincir dağılımını döndürür. Grafikler bu toplamı okur; ham veri tarayıcıda toplanmaz.

**API (`cmd/api`)** — `/health`, `/api/chains|stats|transfers|scores|pools|alerts|analytics` ve
`X-Admin-Key` ile korunan `/api/admin/users|tier|tags`.

**Bot (`apps/bot`)** — Redis `whaleradar:alerts` kanalını dinler; VIP kanal ve VIP DM'leri
anında, free kanal sadece büyük işlemleri gecikmeli alır. Komutlar: `/start`, `/help`,
`/status`, `/top`, `/token`, `/wallet`, `/watch`, `/unwatch`, `/list`, `/threshold`, `/mute`,
`/unmute`, `/vip`, `/paid`, `/myid` — admin: `/grant`, `/revoke`, `/broadcast`, `/stats`.
VIP'e özel takip: `/track <adres> <takma ad> [chain_id]`, `/nick`, `/untrack`, `/whales`,
`/pnl <adres>`. Takip edilen hesap hareket ettiğinde bot kullanıcıya takma adıyla DM atar;
genel akış hiçbir zaman DM'e düşmez.

**Risk süzgeçleri** — Her alert token'ın 24 saatlik gözlenen hacmine oranlanır; oran %10'u
geçerse yüksek volatilite uyarısı eklenir. Değer aynı cüzdan grubunda dönüyorsa (self
transfer, aynı etiket, karşı taraftan geri dönen tutar) alert
`MANİPÜLASYON: YAPAY HACİM YARATMA` olarak işaretlenir.

**Dev hesaplar (`whale_accounts`)** — Scorer 15 dakikada bir, `WHALE_ACCOUNT_WINDOW`
penceresinde `WHALE_ACCOUNT_MIN_USD` (varsayılan $50M) üzerinde hacim döndüren etiketsiz
cüzdanları tabloya yazar ve 30 günlük sonucu hesaplar. Sonuç, cüzdanın penceredeki
girişlerinin son gözlenen fiyatla değerlemesidir: satışlar, köprüler ve gas hariç olduğu
için gerçekleşmiş kâr değil tahmindir.

**Billing (`internal/billing`, scorer içinde)** — VIP ödemeleri USDT ile alınır. Her ödeme
talebi plan fiyatına benzersiz bir kuruş ekler (`9.99`, `10.00`, `10.01`, …), böylece gelen
transfer memo olmadan kullanıcıyla eşleşir. Watcher TRON'da TronGrid TRC-20 API'sini, EVM
ağlarında USDT `Transfer` loglarını okur; eşleşen transferde abonelik 30 gün uzar ve aynı
tx hash ikinci bir talebe uygulanmaz. Süresi dolan talepler ve abonelikler otomatik kapanır.

**Dashboard (`apps/dashboard`)** — Overview, Whale Feed, Accumulation, New Pools, Analiz
(24s/7g/30g grafikleri), Performance (VIP), Dev Hesaplar (VIP: liste, 30g sonuç, takma adlı
takip listesi), VIP/ödeme sayfası, Admin, Yasal (risk bildirimi, kullanım şartları, gizlilik,
ödeme ve iade politikası; TR/EN). Token satırlarında kontrat adresinden çözülen coin logosu
gösterilir, logosu olmayan tokenlerde sembol rozetine düşülür. Her sayfanın altında
"yatırım tavsiyesi değildir" uyarısı ve yasal sayfaya link vardır. Giriş Telegram Login Widget ile yapılır;
oturum HttpOnly cookie'de tutulur (`web_sessions`).

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
- VIP ödeme akışı: site üzerinde `/vip`, Telegram tarafında `/vip` ve `/paid`.
- Telegram Login Widget'ın çalışması için BotFather'da `/setdomain` ile sitenin alan adı
  bota tanıtılmalıdır (`localhost` kabul edilmez, tünel/gerçek alan adı gerekir).
- Mevcut bir Postgres volume'un varsa yeni tabloları elle uygula:
  `docker compose exec -T postgres psql -U whaleradar -d whaleradar -f - < db/migrations/0004_web_auth_billing.sql`
