'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Locale = 'tr' | 'en';

export const LOCALES: { code: Locale; label: string }[] = [
  { code: 'tr', label: 'TR' },
  { code: 'en', label: 'EN' },
];

const STORAGE_KEY = 'whaleradar.locale';

const en = {
  'nav.overview': 'Overview',
  'nav.transfers': 'Whale Feed',
  'nav.tokens': 'Accumulation',
  'nav.pools': 'New Pools',
  'nav.performance': 'Performance',
  'nav.whales': 'Whale Accounts',
  'nav.vip': 'VIP',
  'nav.admin': 'Admin',
  'brand.tagline': 'Multi-chain smart money',

  'nav.analytics': 'Analytics',
  'nav.legal': 'Legal',

  'analytics.title': 'Whale analytics',
  'analytics.subtitle': 'Where whale money moved, how it split between buying and selling pressure, and which assets carried it.',
  'analytics.window': 'Window',
  'analytics.loading': 'Loading chart data…',
  'analytics.empty': 'No data in this window yet.',
  'analytics.totalVolume': 'Whale volume',
  'analytics.net': 'Net flow',
  'analytics.netBuy': 'buying pressure leads',
  'analytics.netSell': 'selling pressure leads',
  'analytics.flowChart': 'Buying vs selling pressure',
  'analytics.buyPressure': 'Exchange outflow + DEX buys',
  'analytics.sellPressure': 'Exchange inflow + DEX sells',
  'analytics.topTokens': 'Assets by whale volume',
  'analytics.byChain': 'Chains by whale volume',
  'analytics.exchanges': 'Exchange inflow / outflow',
  'analytics.topWallets': 'Top active wallets',
  'analytics.heatmap': 'Activity by hour of day',
  'analytics.directions': 'Flow direction breakdown',
  'analytics.compare': 'vs previous {hours}h',
  'analytics.walletLabel': 'Label',
  'analytics.walletAddress': 'Address',
  'analytics.walletVolume': 'Volume',
  'analytics.walletNet': 'Net',
  'analytics.walletTxs': 'Tx',

  'legal.title': 'Terms, privacy and risk',
  'legal.updated': 'Last updated: {date}',
  'legal.riskTitle': 'Risk disclosure',
  'legal.riskBody':
    'WhaleRadar is an on-chain data and analytics service. Nothing here is investment, financial, legal or tax advice, and no signal is a recommendation to buy or sell. Crypto assets are highly volatile and you can lose your entire capital. Scores, accumulation readings and profit/loss figures are estimates derived from public blockchain data and market prices; they are not audited results and past performance does not guarantee future returns. Every decision you make is your own responsibility.',
  'legal.termsTitle': 'Terms of use',
  'legal.termsBody':
    'The service is provided "as is", without any warranty of availability, accuracy or fitness for a purpose. Blockchain nodes, price sources and Telegram may fail or lag, and alerts can be delayed, incomplete or wrong. WhaleRadar is not liable for any loss arising from the use of the service. You may not resell, scrape or redistribute the data, may not use the service where it is unlawful, and must be old enough to enter a contract where you live. Abusive automated access can be rate limited or terminated. We may change features, thresholds and prices; material changes are announced on the site and in the channels.',
  'legal.privacyTitle': 'Privacy',
  'legal.privacyBody':
    'We store only what the service needs: your Telegram ID, username and first name from the login, your membership status and preferences, your watchlist, and payment records (invoice amount, network, transaction hash). We never ask for private keys or seed phrases and cannot move funds. On-chain data we process is already public. Data is not sold; it is shared only with the infrastructure that runs the service (hosting, blockchain data providers, Telegram). Raw transfer history is deleted automatically after 30 days. To delete your account and personal data, message the bot with /delete or contact support; we then remove your profile, sessions and watchlist.',
  'legal.paymentTitle': 'Payment and refunds',
  'legal.paymentBody':
    'VIP costs $9.99 for 30 days, paid in USDT. Each invoice gets a unique amount so the incoming transfer can be matched automatically; send the exact amount on the stated network, from a wallet you control. Payments on the wrong network or to the wrong address cannot be recovered. Membership is credited within minutes of the transfer being confirmed and does not renew automatically. Because access is digital and granted immediately, payments are non-refundable once VIP is active; if a payment cannot be matched or the service is unavailable for a prolonged period, contact support and we will credit the missing days or refund it.',
  'legal.contactTitle': 'Contact',
  'legal.contactBody': 'Support runs through the Telegram bot: {bot}.',
  'legal.footer': 'WhaleRadar does not give investment advice. Past performance does not guarantee future returns.',
  'vip.terms': 'By paying you accept the terms of use, the privacy notice and the refund policy.',

  'auth.login': 'Sign in',
  'auth.logout': 'Sign out',
  'auth.becomeVip': 'Go VIP',
  'auth.loading': 'Loading…',
  'auth.memberOnly': 'Members only',
  'auth.memberOnlyBody': 'Sign in with Telegram to see performance and smart money data.',
  'auth.telegramLogin': 'Sign in with Telegram',
  'auth.vipRequired': 'VIP membership required',
  'auth.vipRequiredBody':
    'Alert track record and smart wallet scores are for VIP members. You can subscribe monthly with USDT.',
  'auth.viewPlan': 'View the VIP plan',

  'login.title': 'Sign in with Telegram',
  'login.body':
    'Your WhaleRadar account is tied to your Telegram identity. After signing in you can start VIP with USDT and unlock performance and smart money data.',
  'login.noBot': '`NEXT_PUBLIC_TELEGRAM_BOT` is not set, so the login button is hidden.',
  'login.signedIn': 'Signed in: {user} ({tier})',
  'login.domainNote':
    'The Telegram login box only works after the bot is bound to this domain with `/setdomain` in BotFather.',

  'overview.title': 'Overview',
  'overview.subtitle':
    'Live whale flow across Ethereum, BNB Chain, Polygon and Arbitrum. Transfers below $50,000 are discarded at ingest.',
  'overview.apiDown': 'API unreachable: {error}. Is the Go API running on {url}?',
  'overview.volume24h': '24h whale volume',
  'overview.transfersSub': '{count} transfers',
  'overview.cexOut': '24h CEX outflow',
  'overview.cexOutSub': 'supply leaving exchanges',
  'overview.cexIn': '24h CEX inflow',
  'overview.cexInSub': 'potential sell pressure',
  'overview.newPools': 'New pools (24h)',
  'overview.newPoolsSub': '{count} tracked tokens',
  'overview.liveFeed': 'Live alert feed',
  'overview.autoRefresh': 'auto-refresh 8s',
  'overview.loadingAlerts': 'Loading alerts…',
  'overview.noAlerts': 'No alerts yet — the listener publishes here as whales move.',
  'overview.noAlertsAbove': 'No move above {size} in the recent window. Lower the floor to see more.',
  'overview.minSize': 'Min size',
  'overview.topAccumulation': 'Top accumulation',
  'overview.noScores': 'Scores appear once the scorer has 24h of data.',
  'overview.networks': 'Tracked networks',
  'overview.chainId': 'Chain ID {id}',

  'transfers.title': 'Whale feed',
  'transfers.subtitle': 'Every priced transfer above the ingest floor, newest first.',
  'transfers.allChains': 'All chains',
  'transfers.allDirections': 'All directions',
  'transfers.minUsd': 'Min USD',
  'transfers.wallet': 'Wallet or token',
  'transfers.loading': 'Loading transfers…',
  'transfers.empty': 'No transfers match these filters yet.',
  'transfers.view': 'view',

  'tokens.title': 'Accumulation scores',
  'tokens.subtitle':
    '0–100 score from 24h DEX net buying versus net exchange withdrawals, weighted by size and buyer breadth.',
  'tokens.loading': 'Loading scores…',
  'tokens.empty': 'The scorer publishes results every few minutes once transfers are recorded.',

  'pools.title': 'New liquidity pools',
  'pools.subtitle': 'Resolved from V2 PairCreated and V3 PoolCreated logs on every registered factory.',
  'pools.loading': 'Loading pools…',
  'pools.empty': 'No pools discovered yet.',

  'perf.title': 'Signal performance',
  'perf.subtitle':
    'Every published alert is priced again after 1h, 4h and 24h, so the track record is measured instead of claimed. Past results are not a promise of future returns.',
  'perf.horizon': '{horizon} horizon',
  'perf.win': '{pct}% win',
  'perf.horizonSub': '{samples} signals · avg {avg} · best {best}',
  'perf.smartWallets': 'Smart money wallets',
  'perf.walletsLoading': 'Loading wallets…',
  'perf.walletsEmpty': 'Wallet track records need a few days of history.',
  'perf.trackedAlerts': 'Tracked alerts',
  'perf.alertsLoading': 'Loading alerts…',
  'perf.alertsEmpty': 'No alerts tracked yet.',
  'perf.pending': 'pending',

  'whales.title': 'Whale accounts',
  'whales.subtitle':
    'Accounts that moved more than the tracking threshold in the last 30 days. Follow one and the bot messages you on every move it makes.',
  'whales.account': 'Account',
  'whales.volume': '30d volume',
  'whales.flow': 'In / out',
  'whales.txs': 'Transactions',
  'whales.tokens': 'Tokens',
  'whales.pnl': '30d result',
  'whales.follow': 'Follow',
  'whales.following': 'Following',
  'whales.loading': 'Loading accounts…',
  'whales.empty': 'No account has crossed the threshold yet. The list refreshes every 15 minutes.',
  'whales.watchlist': 'My tracked accounts',
  'whales.watchEmpty': 'You are not following anyone yet. Follow an account below or use /track in the bot.',
  'whales.alias': 'Nickname',
  'whales.aliasPlaceholder': 'e.g. Binance whale',
  'whales.address': 'Address',
  'whales.add': 'Follow',
  'whales.remove': 'Remove',
  'whales.dmNote': 'Alerts are sent as a Telegram DM by the bot. Send /start to the bot once so it can message you.',
  'whales.pnlNote':
    'The result values entries at the latest observed price. Sells, bridges and gas are not included, so treat it as an estimate, not accounting. Not investment advice.',

  'vip.title': 'WhaleRadar VIP',
  'vip.per': '/ {days} days',
  'vip.benefit1': 'Live VIP channel feed of $100k+ whale moves',
  'vip.benefit2': 'Alert track record (1h / 4h / 24h return, win rate)',
  'vip.benefit3': 'Smart money wallet scores and cluster detection',
  'vip.benefit4': 'Per-token 24h accumulation analysis',
  'vip.disclaimer': 'Past performance does not guarantee future returns. WhaleRadar does not give investment advice.',
  'vip.loginFirst': 'Sign in with Telegram before subscribing.',
  'vip.active': 'Your VIP membership is active',
  'vip.activeUntil': ' — expires: {date}',
  'vip.extend': 'Extend by 30 days',
  'vip.notConfigured': 'The payment address is not configured yet, try again shortly.',
  'vip.payIntro':
    'You pay with USDT on the {network} network. A unique amount is generated for you; membership unlocks automatically once it arrives.',
  'vip.creating': 'Creating…',
  'vip.startPayment': 'Start payment',
  'vip.history': 'Payment history',
  'vip.pending': 'Pending payment',
  'vip.pendingBody':
    'Send exactly the amount shown to the address below. The final cents identify your payment, so do not round.',
  'vip.network': 'Network',
  'vip.amount': 'Amount',
  'vip.address': 'Address',
  'vip.expires': 'Valid until',
  'vip.copy': 'copy',
  'vip.copied': 'copied',
  'vip.pendingNote':
    'This page updates itself once the payment is confirmed (usually 1-2 minutes). Transfers sent on the wrong network can be lost, check the network.',
  'vip.invoiceFailed': 'invoice failed',

  'admin.title': 'Admin',
  'admin.subtitle': 'Manage VIP subscriptions and wallet labelling. Requires the API admin key.',
  'admin.key': 'Admin API key',
  'admin.load': 'Load subscribers',
  'admin.subscribers': 'Telegram subscribers',
  'admin.telegramId': 'Telegram ID',
  'admin.username': 'Username',
  'admin.tier': 'Tier',
  'admin.vipExpires': 'VIP expires',
  'admin.dmThreshold': 'DM threshold',
  'admin.actions': 'Actions',
  'admin.grant30': '+30d VIP',
  'admin.revoke': 'Revoke',
  'admin.empty': 'Enter the admin key and load subscribers.',
  'admin.labelling': 'Wallet labelling',
  'admin.address': 'Address',
  'admin.label': 'Label',
  'admin.category': 'Category',
  'admin.saveLabel': 'Save label',

  'common.time': 'Time',
  'common.chain': 'Chain',
  'common.token': 'Token',
  'common.direction': 'Direction',
  'common.amount': 'Amount',
  'common.value': 'Value',
  'common.from': 'From',
  'common.to': 'To',
  'common.tx': 'Tx',
  'common.score': 'Score',
  'common.regime': 'Regime',
  'common.dexBuys': 'DEX buys',
  'common.dexSells': 'DEX sells',
  'common.cexOutflow': 'CEX outflow',
  'common.cexInflow': 'CEX inflow',
  'common.net': 'Net',
  'common.whaleTxs': 'Whale txs',
  'common.created': 'Created',
  'common.dex': 'DEX',
  'common.pool': 'Pool',
  'common.token0': 'Token 0',
  'common.token1': 'Token 1',
  'common.fee': 'Fee',
  'common.wallet': 'Wallet',
  'common.rating': 'Rating',
  'common.trades': 'Trades',
  'common.winRate': 'Win rate',
  'common.avg24h': 'Avg 24h',
  'common.volume': 'Volume',
  'common.when': 'When',
  'common.signal': 'Signal',
  'common.size': 'Size',
  'common.status': 'Status',
} as const;

export type MessageKey = keyof typeof en;

const tr: Record<MessageKey, string> = {
  'nav.overview': 'Genel Bakış',
  'nav.transfers': 'Balina Akışı',
  'nav.tokens': 'Birikim',
  'nav.pools': 'Yeni Havuzlar',
  'nav.performance': 'Performans',
  'nav.whales': 'Dev Hesaplar',
  'nav.vip': 'VIP',
  'nav.admin': 'Yönetim',
  'brand.tagline': 'Çok zincirli akıllı para',

  'nav.analytics': 'Analiz',
  'nav.legal': 'Yasal',

  'analytics.title': 'Balina analizi',
  'analytics.subtitle': 'Balina parası nereye aktı, ne kadarı alım ne kadarı satış baskısıydı ve hangi varlıklar taşıdı.',
  'analytics.window': 'Aralık',
  'analytics.loading': 'Grafik verisi yükleniyor…',
  'analytics.empty': 'Bu aralıkta henüz veri yok.',
  'analytics.totalVolume': 'Balina hacmi',
  'analytics.net': 'Net akış',
  'analytics.netBuy': 'alım baskısı önde',
  'analytics.netSell': 'satış baskısı önde',
  'analytics.flowChart': 'Alım ve satış baskısı',
  'analytics.buyPressure': 'Borsa çıkışı + DEX alımı',
  'analytics.sellPressure': 'Borsa girişi + DEX satışı',
  'analytics.topTokens': 'Hacme göre varlıklar',
  'analytics.byChain': 'Hacme göre zincirler',
  'analytics.exchanges': 'Borsa girişi / çıkışı',
  'analytics.topWallets': 'En aktif cüzdanlar',
  'analytics.heatmap': 'Güne göre saatlik aktivite',
  'analytics.directions': 'Akış yönü dağılımı',
  'analytics.compare': 'önceki {hours}saate göre',
  'analytics.walletLabel': 'Etiket',
  'analytics.walletAddress': 'Adres',
  'analytics.walletVolume': 'Hacim',
  'analytics.walletNet': 'Net',
  'analytics.walletTxs': 'Tx',

  'legal.title': 'Kullanım şartları, gizlilik ve risk',
  'legal.updated': 'Son güncelleme: {date}',
  'legal.riskTitle': 'Risk bildirimi',
  'legal.riskBody':
    'WhaleRadar bir zincir üstü veri ve analiz servisidir. Buradaki hiçbir içerik yatırım, finansal, hukuki veya vergisel tavsiye değildir; hiçbir sinyal alım ya da satım önerisi sayılmaz. Kripto varlıklar yüksek oynaklığa sahiptir ve tüm sermayeni kaybedebilirsin. Skorlar, birikim okumaları ve kâr/zarar rakamları kamuya açık blokzincir verisi ile piyasa fiyatlarından üretilen tahminlerdir; denetlenmiş sonuç değildir ve geçmiş performans gelecekteki getiriyi garanti etmez. Verdiğin her karar senin sorumluluğundadır.',
  'legal.termsTitle': 'Kullanım şartları',
  'legal.termsBody':
    'Servis "olduğu gibi" sunulur; erişilebilirlik, doğruluk veya belirli bir amaca uygunluk garantisi verilmez. Blokzincir düğümleri, fiyat kaynakları ve Telegram arıza verebilir veya gecikebilir; alertler gecikmeli, eksik ya da hatalı olabilir. Servisin kullanımından doğan zararlardan WhaleRadar sorumlu tutulamaz. Veriyi yeniden satamaz, kazıyamaz veya dağıtamazsın; servisi yasak olduğu yerlerde kullanamazsın ve bulunduğun ülkede sözleşme yapabilecek yaşta olmalısın. Kötüye kullanılan otomatik erişim sınırlanabilir veya kapatılabilir. Özellikler, eşikler ve fiyatlar değişebilir; önemli değişiklikler sitede ve kanallarda duyurulur.',
  'legal.privacyTitle': 'Gizlilik',
  'legal.privacyBody':
    'Yalnızca servisin ihtiyaç duyduğu veriyi saklıyoruz: girişten gelen Telegram kimliğin, kullanıcı adın ve adın, üyelik durumun ve tercihlerin, takip listen ve ödeme kayıtların (fatura tutarı, ağ, işlem hash\'i). Özel anahtar veya kurtarma cümlesi hiçbir zaman istenmez; fonlarına erişimimiz yoktur. İşlediğimiz zincir üstü veriler zaten kamuya açıktır. Veriler satılmaz; yalnızca servisi çalıştıran altyapıyla (barındırma, blokzincir veri sağlayıcıları, Telegram) paylaşılır. Ham transfer geçmişi 30 gün sonra otomatik silinir. Hesabını ve kişisel verilerini silmek için bota /delete yaz ya da destekle iletişime geç; profilini, oturumlarını ve takip listeni kaldırırız.',
  'legal.paymentTitle': 'Ödeme ve iade',
  'legal.paymentBody':
    'VIP üyelik 30 gün için 9,99 USD olup USDT ile ödenir. Her faturaya benzersiz bir tutar verilir; böylece gelen transfer otomatik eşleşir. Tutarı belirtilen ağda, kendi kontrolündeki bir cüzdandan tam olarak gönder. Yanlış ağa veya yanlış adrese yapılan ödemeler geri getirilemez. Üyelik, transfer onaylandıktan sonra birkaç dakika içinde tanımlanır ve otomatik yenilenmez. Erişim dijital olduğu ve anında verildiği için VIP aktifleştikten sonra ödemeler iade edilmez; ödeme eşleşmezse veya servis uzun süre kullanılamazsa destekle iletişime geç, eksik günleri ekler ya da iade ederiz.',
  'legal.contactTitle': 'İletişim',
  'legal.contactBody': 'Destek Telegram botu üzerinden yürür: {bot}.',
  'legal.footer': 'WhaleRadar yatırım tavsiyesi vermez. Geçmiş performans gelecekteki getiriyi garanti etmez.',
  'vip.terms': 'Ödeme yaparak kullanım şartlarını, gizlilik bildirimini ve iade politikasını kabul etmiş olursun.',

  'auth.login': 'Giriş yap',
  'auth.logout': 'Çıkış',
  'auth.becomeVip': 'VIP ol',
  'auth.loading': 'Yükleniyor…',
  'auth.memberOnly': 'Bu sayfa üyelere özel',
  'auth.memberOnlyBody':
    'Performans ve akıllı para verilerini görmek için Telegram ile giriş yapman gerekiyor.',
  'auth.telegramLogin': 'Telegram ile giriş yap',
  'auth.vipRequired': 'VIP üyelik gerekiyor',
  'auth.vipRequiredBody':
    'Alert performans geçmişi ve akıllı cüzdan skorları VIP üyelere açık. USDT ile aylık abone olabilirsin.',
  'auth.viewPlan': 'VIP planını gör',

  'login.title': 'Telegram ile giriş',
  'login.body':
    'WhaleRadar hesabın Telegram kimliğine bağlı. Giriş yaptıktan sonra VIP üyeliğini USDT ile başlatabilir, performans ve akıllı para verilerine erişebilirsin.',
  'login.noBot': '`NEXT_PUBLIC_TELEGRAM_BOT` tanımlı değil, giriş düğmesi görünmüyor.',
  'login.signedIn': 'Giriş yapıldı: {user} ({tier})',
  'login.domainNote':
    'Telegram giriş kutusu yalnızca botun BotFather üzerinden `/setdomain` ile bu alan adına bağlanmasından sonra çalışır.',

  'overview.title': 'Genel bakış',
  'overview.subtitle':
    'Ethereum, BNB Chain, Polygon ve Arbitrum üzerinde canlı balina akışı. $50.000 altındaki transferler daha girişte eleniyor.',
  'overview.apiDown': 'API\'ye ulaşılamıyor: {error}. Go API {url} adresinde çalışıyor mu?',
  'overview.volume24h': '24s balina hacmi',
  'overview.transfersSub': '{count} transfer',
  'overview.cexOut': '24s borsa çıkışı',
  'overview.cexOutSub': 'borsalardan çıkan arz',
  'overview.cexIn': '24s borsa girişi',
  'overview.cexInSub': 'olası satış baskısı',
  'overview.newPools': 'Yeni havuz (24s)',
  'overview.newPoolsSub': '{count} takip edilen token',
  'overview.liveFeed': 'Canlı alert akışı',
  'overview.autoRefresh': '8 sn\'de bir yenilenir',
  'overview.loadingAlerts': 'Alertler yükleniyor…',
  'overview.noAlerts': 'Henüz alert yok — balinalar hareket ettikçe listener buraya yazar.',
  'overview.noAlertsAbove': 'Son pencerede {size} üstü hareket yok. Eşiği düşürüp daha fazlasını görebilirsin.',
  'overview.minSize': 'Min büyüklük',
  'overview.topAccumulation': 'En çok toplanan',
  'overview.noScores': 'Skorlar, scorer 24 saatlik veriye ulaşınca görünür.',
  'overview.networks': 'Takip edilen ağlar',
  'overview.chainId': 'Zincir ID {id}',

  'transfers.title': 'Balina akışı',
  'transfers.subtitle': 'Giriş eşiğinin üzerindeki tüm fiyatlanmış transferler, en yeniden eskiye.',
  'transfers.allChains': 'Tüm zincirler',
  'transfers.allDirections': 'Tüm yönler',
  'transfers.minUsd': 'Min USD',
  'transfers.wallet': 'Cüzdan veya token',
  'transfers.loading': 'Transferler yükleniyor…',
  'transfers.empty': 'Bu filtrelere uyan transfer yok.',
  'transfers.view': 'gör',

  'tokens.title': 'Birikim skorları',
  'tokens.subtitle':
    '24 saatlik DEX net alımı ile borsadan net çekimlere dayanan 0–100 skor; büyüklük ve alıcı çeşitliliğine göre ağırlıklandırılır.',
  'tokens.loading': 'Skorlar yükleniyor…',
  'tokens.empty': 'Transferler kaydedildikçe scorer birkaç dakikada bir sonuç yayınlar.',

  'pools.title': 'Yeni likidite havuzları',
  'pools.subtitle': 'Kayıtlı her factory üzerindeki V2 PairCreated ve V3 PoolCreated loglarından çözümlenir.',
  'pools.loading': 'Havuzlar yükleniyor…',
  'pools.empty': 'Henüz havuz bulunamadı.',

  'perf.title': 'Sinyal performansı',
  'perf.subtitle':
    'Yayınlanan her alert 1s, 4s ve 24s sonra yeniden fiyatlanır; yani geçmiş başarı iddia edilmez, ölçülür. Geçmiş sonuçlar gelecekteki getiriyi garanti etmez.',
  'perf.horizon': '{horizon} vade',
  'perf.win': '%{pct} isabet',
  'perf.horizonSub': '{samples} sinyal · ort {avg} · en iyi {best}',
  'perf.smartWallets': 'Akıllı para cüzdanları',
  'perf.walletsLoading': 'Cüzdanlar yükleniyor…',
  'perf.walletsEmpty': 'Cüzdan geçmişi için birkaç günlük veri gerekiyor.',
  'perf.trackedAlerts': 'Takip edilen alertler',
  'perf.alertsLoading': 'Alertler yükleniyor…',
  'perf.alertsEmpty': 'Henüz takip edilen alert yok.',
  'perf.pending': 'bekliyor',

  'whales.title': 'Dev hesaplar',
  'whales.subtitle':
    'Son 30 günde takip eşiğinin üzerinde hacim döndüren hesaplar. Takibe aldığın hesabın her hareketinde bot sana özel mesaj atar.',
  'whales.account': 'Hesap',
  'whales.volume': '30g hacim',
  'whales.flow': 'Giriş / çıkış',
  'whales.txs': 'İşlem',
  'whales.tokens': 'Token',
  'whales.pnl': '30g sonuç',
  'whales.follow': 'Takip et',
  'whales.following': 'Takipte',
  'whales.loading': 'Hesaplar yükleniyor…',
  'whales.empty': 'Henüz eşiği aşan hesap yok. Liste 15 dakikada bir yenileniyor.',
  'whales.watchlist': 'Takip ettiğim hesaplar',
  'whales.watchEmpty': 'Henüz kimseyi takip etmiyorsun. Aşağıdan ekle ya da botta /track kullan.',
  'whales.alias': 'Takma ad',
  'whales.aliasPlaceholder': 'örn. Binance balinası',
  'whales.address': 'Adres',
  'whales.add': 'Takibe al',
  'whales.remove': 'Kaldır',
  'whales.dmNote': 'Bildirimler Telegram’da bottan DM olarak gelir. Bota bir kez /start yazman gerekiyor.',
  'whales.pnlNote':
    'Sonuç, girişlerin güncel fiyata göre değerlemesidir. Satışlar, köprüler ve gas dahil değildir; muhasebe değil tahmindir. Yatırım tavsiyesi değildir.',

  'vip.title': 'WhaleRadar VIP',
  'vip.per': '/ {days} gün',
  'vip.benefit1': '$100k+ balina işlemlerinin anlık VIP kanal akışı',
  'vip.benefit2': 'Alert performans geçmişi (1s / 4s / 24s getiri, isabet oranı)',
  'vip.benefit3': 'Akıllı para cüzdan skorları ve cluster tespiti',
  'vip.benefit4': 'Token bazlı 24 saatlik birikim analizi',
  'vip.disclaimer':
    'Geçmiş performans gelecekteki getiriyi garanti etmez. WhaleRadar yatırım tavsiyesi vermez.',
  'vip.loginFirst': 'Abone olmak için önce Telegram ile giriş yap.',
  'vip.active': 'VIP üyeliğin aktif',
  'vip.activeUntil': ' — bitiş: {date}',
  'vip.extend': '30 gün daha uzat',
  'vip.notConfigured': 'Ödeme adresi henüz yapılandırılmadı, birazdan tekrar dene.',
  'vip.payIntro':
    'Ödemeyi {network} ağı üzerinden USDT ile yapıyorsun. Sana özel bir tutar üretiliyor; o tutar geldiğinde üyeliğin otomatik açılıyor.',
  'vip.creating': 'Oluşturuluyor…',
  'vip.startPayment': 'Ödeme başlat',
  'vip.history': 'Ödeme geçmişi',
  'vip.pending': 'Bekleyen ödeme',
  'vip.pendingBody':
    'Aşağıdaki adrese tam olarak gösterilen tutarı gönder. Tutarın son kuruşları ödemeni hesabınla eşleştirmek için kullanılıyor, bu yüzden yuvarlama yapma.',
  'vip.network': 'Ağ',
  'vip.amount': 'Tutar',
  'vip.address': 'Adres',
  'vip.expires': 'Geçerlilik',
  'vip.copy': 'kopyala',
  'vip.copied': 'kopyalandı',
  'vip.pendingNote':
    'Ödeme onaylandığında bu sayfa kendiliğinden güncellenir (genelde 1-2 dakika). Yanlış ağdan gönderilen transferler kaybolabilir, ağı kontrol et.',
  'vip.invoiceFailed': 'ödeme talebi oluşturulamadı',

  'admin.title': 'Yönetim',
  'admin.subtitle': 'VIP abonelikleri ve cüzdan etiketlemesi. API yönetici anahtarı gerekir.',
  'admin.key': 'Yönetici API anahtarı',
  'admin.load': 'Aboneleri yükle',
  'admin.subscribers': 'Telegram aboneleri',
  'admin.telegramId': 'Telegram ID',
  'admin.username': 'Kullanıcı adı',
  'admin.tier': 'Seviye',
  'admin.vipExpires': 'VIP bitiş',
  'admin.dmThreshold': 'DM eşiği',
  'admin.actions': 'İşlemler',
  'admin.grant30': '+30g VIP',
  'admin.revoke': 'Kaldır',
  'admin.empty': 'Yönetici anahtarını girip aboneleri yükle.',
  'admin.labelling': 'Cüzdan etiketleme',
  'admin.address': 'Adres',
  'admin.label': 'Etiket',
  'admin.category': 'Kategori',
  'admin.saveLabel': 'Etiketi kaydet',

  'common.time': 'Zaman',
  'common.chain': 'Zincir',
  'common.token': 'Token',
  'common.direction': 'Yön',
  'common.amount': 'Miktar',
  'common.value': 'Değer',
  'common.from': 'Gönderen',
  'common.to': 'Alan',
  'common.tx': 'İşlem',
  'common.score': 'Skor',
  'common.regime': 'Rejim',
  'common.dexBuys': 'DEX alım',
  'common.dexSells': 'DEX satım',
  'common.cexOutflow': 'Borsa çıkışı',
  'common.cexInflow': 'Borsa girişi',
  'common.net': 'Net',
  'common.whaleTxs': 'Balina işlemi',
  'common.created': 'Oluşturuldu',
  'common.dex': 'DEX',
  'common.pool': 'Havuz',
  'common.token0': 'Token 0',
  'common.token1': 'Token 1',
  'common.fee': 'Komisyon',
  'common.wallet': 'Cüzdan',
  'common.rating': 'Değerlendirme',
  'common.trades': 'İşlem',
  'common.winRate': 'İsabet',
  'common.avg24h': 'Ort. 24s',
  'common.volume': 'Hacim',
  'common.when': 'Ne zaman',
  'common.signal': 'Sinyal',
  'common.size': 'Büyüklük',
  'common.status': 'Durum',
};

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { en, tr };

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

const I18nContext = createContext<I18nState>({
  locale: 'tr',
  setLocale: () => {},
  t: (key) => MESSAGES.tr[key],
});

function isLocale(value: string | null): value is Locale {
  return value === 'tr' || value === 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // Server render always uses the default locale; the stored choice is applied
  // on mount so the markup stays hydration-safe.
  const [locale, setLocaleState] = useState<Locale>('tr');

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) {
      setLocaleState(stored);
      return;
    }
    if (!navigator.language.toLowerCase().startsWith('tr')) setLocaleState('en');
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const t = useCallback<Translate>(
    (key, vars) => {
      const template = MESSAGES[locale][key] ?? MESSAGES.en[key] ?? key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match,
      );
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nState {
  return useContext(I18nContext);
}
