package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ErrNoInvoiceSlot means every cent variant of the plan price is currently reserved.
var ErrNoInvoiceSlot = errors.New("no free invoice amount available, try again later")

// Invoice is a USDT subscription payment request matched by its unique amount.
type Invoice struct {
	ID         int64      `json:"id"`
	TelegramID int64      `json:"telegram_id"`
	Plan       string     `json:"plan"`
	Days       int        `json:"days"`
	AmountUSDT float64    `json:"amount_usdt"`
	Network    string     `json:"network"`
	PayTo      string     `json:"pay_to"`
	Status     string     `json:"status"`
	TxHash     string     `json:"tx_hash"`
	CreatedAt  time.Time  `json:"created_at"`
	ExpiresAt  time.Time  `json:"expires_at"`
	PaidAt     *time.Time `json:"paid_at"`
}

// EnsureBotUser creates the Telegram user row on first web sign-in.
func (p *Postgres) EnsureBotUser(ctx context.Context, telegramID int64, username, firstName string, minUSD float64) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO bot_users (telegram_id, username, first_name, min_usd)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (telegram_id) DO UPDATE
		SET username = EXCLUDED.username, first_name = EXCLUDED.first_name, updated_at = now()`,
		telegramID, username, firstName, minUSD)
	return err
}

// CreateSession stores a dashboard session token.
func (p *Postgres) CreateSession(ctx context.Context, token string, telegramID int64, ttl time.Duration) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO web_sessions (token, telegram_id, expires_at) VALUES ($1, $2, now() + $3::interval)`,
		token, telegramID, ttl.String())
	return err
}

// SessionUser resolves a session token to its subscriber, dropping expired rows.
func (p *Postgres) SessionUser(ctx context.Context, token string) (BotUser, bool, error) {
	var u BotUser
	err := p.pool.QueryRow(ctx, `
		SELECT b.telegram_id, COALESCE(b.username,''), b.tier, b.vip_expires_at, b.min_usd, b.muted, b.created_at
		FROM web_sessions s
		JOIN bot_users b ON b.telegram_id = s.telegram_id
		WHERE s.token = $1 AND s.expires_at > now()`, token).
		Scan(&u.TelegramID, &u.Username, &u.Tier, &u.VIPExpiresAt, &u.MinUSD, &u.Muted, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return BotUser{}, false, nil
	}
	return u, err == nil, err
}

// DeleteSession signs a user out.
func (p *Postgres) DeleteSession(ctx context.Context, token string) error {
	_, err := p.pool.Exec(ctx, `DELETE FROM web_sessions WHERE token = $1`, token)
	return err
}

// OpenInvoice returns the user's still-valid pending invoice, if any.
func (p *Postgres) OpenInvoice(ctx context.Context, telegramID int64) (Invoice, bool, error) {
	inv, err := p.scanInvoice(p.pool.QueryRow(ctx, `
		SELECT id, telegram_id, plan, days, amount_usdt, network, pay_to, status,
		       COALESCE(tx_hash,''), created_at, expires_at, paid_at
		FROM invoices
		WHERE telegram_id = $1 AND status = 'pending' AND expires_at > now()
		ORDER BY created_at DESC LIMIT 1`, telegramID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Invoice{}, false, nil
	}
	return inv, err == nil, err
}

// CreateInvoice reserves a unique cent amount near the plan price so the incoming
// USDT transfer can be matched on-chain without a memo field.
func (p *Postgres) CreateInvoice(ctx context.Context, telegramID int64, plan string, days int,
	basePrice float64, network, payTo string, ttl time.Duration) (Invoice, error) {
	for cents := 0; cents < 100; cents++ {
		amount := basePrice + float64(cents)/100
		inv, err := p.scanInvoice(p.pool.QueryRow(ctx, `
			INSERT INTO invoices (telegram_id, plan, days, amount_usdt, network, pay_to, expires_at)
			VALUES ($1, $2, $3, $4, $5, $6, now() + $7::interval)
			ON CONFLICT DO NOTHING
			RETURNING id, telegram_id, plan, days, amount_usdt, network, pay_to, status,
			          COALESCE(tx_hash,''), created_at, expires_at, paid_at`,
			telegramID, plan, days, amount, network, payTo, ttl.String()))
		if errors.Is(err, pgx.ErrNoRows) {
			continue // that amount is taken by another live invoice
		}
		if err != nil {
			return Invoice{}, err
		}
		return inv, nil
	}
	return Invoice{}, ErrNoInvoiceSlot
}

// PendingInvoices lists invoices awaiting an on-chain payment.
func (p *Postgres) PendingInvoices(ctx context.Context) ([]Invoice, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT id, telegram_id, plan, days, amount_usdt, network, pay_to, status,
		       COALESCE(tx_hash,''), created_at, expires_at, paid_at
		FROM invoices WHERE status = 'pending' ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Invoice{}
	for rows.Next() {
		var i Invoice
		if err := rows.Scan(&i.ID, &i.TelegramID, &i.Plan, &i.Days, &i.AmountUSDT, &i.Network, &i.PayTo,
			&i.Status, &i.TxHash, &i.CreatedAt, &i.ExpiresAt, &i.PaidAt); err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

// SettledTxHashes returns the transfers already credited to an invoice.
func (p *Postgres) SettledTxHashes(ctx context.Context) (map[string]struct{}, error) {
	rows, err := p.pool.Query(ctx, `SELECT tx_hash FROM invoices WHERE status = 'paid' AND tx_hash IS NOT NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]struct{}{}
	for rows.Next() {
		var hash string
		if err := rows.Scan(&hash); err != nil {
			return nil, err
		}
		out[strings.ToLower(hash)] = struct{}{}
	}
	return out, rows.Err()
}

// MarkInvoicePaid settles an invoice and extends the subscriber's VIP window.
func (p *Postgres) MarkInvoicePaid(ctx context.Context, id int64, txHash string) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var telegramID int64
	var days int
	err = tx.QueryRow(ctx, `
		UPDATE invoices SET status = 'paid', tx_hash = $2, paid_at = now()
		WHERE id = $1 AND status = 'pending'
		RETURNING telegram_id, days`, id, txHash).Scan(&telegramID, &days)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // already settled
	}
	if err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE bot_users
		SET tier = 'vip',
		    vip_expires_at = GREATEST(COALESCE(vip_expires_at, now()), now()) + make_interval(days => $2),
		    updated_at = now()
		WHERE telegram_id = $1`, telegramID, days); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ExpireInvoices closes invoices whose payment window elapsed.
func (p *Postgres) ExpireInvoices(ctx context.Context) (int64, error) {
	tag, err := p.pool.Exec(ctx, `
		UPDATE invoices SET status = 'expired' WHERE status = 'pending' AND expires_at < now()`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// ExpireSubscriptions downgrades VIP users whose paid period ended.
func (p *Postgres) ExpireSubscriptions(ctx context.Context) (int64, error) {
	tag, err := p.pool.Exec(ctx, `
		UPDATE bot_users SET tier = 'free', updated_at = now()
		WHERE tier = 'vip' AND vip_expires_at IS NOT NULL AND vip_expires_at < now()`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// UserInvoices lists a subscriber's billing history.
func (p *Postgres) UserInvoices(ctx context.Context, telegramID int64, limit int) ([]Invoice, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := p.pool.Query(ctx, `
		SELECT id, telegram_id, plan, days, amount_usdt, network, pay_to, status,
		       COALESCE(tx_hash,''), created_at, expires_at, paid_at
		FROM invoices WHERE telegram_id = $1 ORDER BY created_at DESC LIMIT $2`, telegramID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Invoice{}
	for rows.Next() {
		var i Invoice
		if err := rows.Scan(&i.ID, &i.TelegramID, &i.Plan, &i.Days, &i.AmountUSDT, &i.Network, &i.PayTo,
			&i.Status, &i.TxHash, &i.CreatedAt, &i.ExpiresAt, &i.PaidAt); err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

func (p *Postgres) scanInvoice(row pgx.Row) (Invoice, error) {
	var i Invoice
	err := row.Scan(&i.ID, &i.TelegramID, &i.Plan, &i.Days, &i.AmountUSDT, &i.Network, &i.PayTo,
		&i.Status, &i.TxHash, &i.CreatedAt, &i.ExpiresAt, &i.PaidAt)
	return i, err
}
