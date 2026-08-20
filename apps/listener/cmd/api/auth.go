package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/whaleradar/listener/internal/store"
)

const (
	sessionCookie = "wr_session"
	sessionTTL    = 30 * 24 * time.Hour
	// loginMaxAge rejects replayed Telegram login payloads.
	loginMaxAge = 24 * time.Hour
)

// telegramLogin is the payload produced by the Telegram Login Widget.
type telegramLogin struct {
	ID        int64  `json:"id"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Username  string `json:"username"`
	PhotoURL  string `json:"photo_url"`
	AuthDate  int64  `json:"auth_date"`
	Hash      string `json:"hash"`
}

// verify checks the widget signature: HMAC-SHA256 over the sorted data-check
// string, keyed by SHA256 of the bot token.
func (l telegramLogin) verify(botToken string) error {
	if botToken == "" {
		return fmt.Errorf("bot token is not configured")
	}
	fields := map[string]string{
		"id":        strconv.FormatInt(l.ID, 10),
		"auth_date": strconv.FormatInt(l.AuthDate, 10),
	}
	if l.FirstName != "" {
		fields["first_name"] = l.FirstName
	}
	if l.LastName != "" {
		fields["last_name"] = l.LastName
	}
	if l.Username != "" {
		fields["username"] = l.Username
	}
	if l.PhotoURL != "" {
		fields["photo_url"] = l.PhotoURL
	}

	keys := make([]string, 0, len(fields))
	for k := range fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+fields[k])
	}

	secret := sha256.Sum256([]byte(botToken))
	mac := hmac.New(sha256.New, secret[:])
	mac.Write([]byte(strings.Join(parts, "\n")))
	want := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(want), []byte(strings.ToLower(l.Hash))) {
		return fmt.Errorf("signature mismatch")
	}
	if time.Since(time.Unix(l.AuthDate, 0)) > loginMaxAge {
		return fmt.Errorf("login payload expired")
	}
	return nil
}

func newSessionToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// currentUser resolves the session cookie (or Bearer token) to a subscriber.
func (s *server) currentUser(r *http.Request) (store.BotUser, bool) {
	token := ""
	if c, err := r.Cookie(sessionCookie); err == nil {
		token = c.Value
	}
	if token == "" {
		token = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	}
	if strings.TrimSpace(token) == "" {
		return store.BotUser{}, false
	}
	user, ok, err := s.pg.SessionUser(r.Context(), token)
	if err != nil {
		s.logger.Warn("session lookup failed", "err", err)
		return store.BotUser{}, false
	}
	return user, ok
}

// isVIP reports whether the subscription is active right now.
func isVIP(u store.BotUser) bool {
	if u.Tier != "vip" {
		return false
	}
	return u.VIPExpiresAt == nil || u.VIPExpiresAt.After(time.Now())
}

// vipOnly gates the premium endpoints behind an active subscription.
func (s *server) vipOnly(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.currentUser(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "sign in with Telegram to continue"})
			return
		}
		if !isVIP(user) {
			writeJSON(w, http.StatusPaymentRequired, map[string]string{"error": "VIP subscription required"})
			return
		}
		next(w, r)
	})
}
