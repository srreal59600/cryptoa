package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/whaleradar/listener/internal/store"
)

// authRoutes registers sign-in, profile and USDT subscription endpoints.
func (s *server) authRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/auth/telegram", func(w http.ResponseWriter, r *http.Request) {
		var login telegramLogin
		if err := json.NewDecoder(r.Body).Decode(&login); err != nil || login.ID == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid login payload"})
			return
		}
		if err := login.verify(s.botToken); err != nil {
			s.logger.Warn("telegram login rejected", "err", err)
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "login verification failed"})
			return
		}
		if err := s.pg.EnsureBotUser(r.Context(), login.ID, login.Username, login.FirstName, s.cfg.AlertUSD); err != nil {
			s.fail(w, err)
			return
		}
		token, err := newSessionToken()
		if err != nil {
			s.fail(w, err)
			return
		}
		if err := s.pg.CreateSession(r.Context(), token, login.ID, sessionTTL); err != nil {
			s.fail(w, err)
			return
		}
		http.SetCookie(w, &http.Cookie{
			Name:     sessionCookie,
			Value:    token,
			Path:     "/",
			HttpOnly: true,
			Secure:   s.secure,
			SameSite: http.SameSiteLaxMode,
			Expires:  time.Now().Add(sessionTTL),
		})
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "token": token})
	})

	mux.HandleFunc("POST /api/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		if c, err := r.Cookie(sessionCookie); err == nil {
			if err := s.pg.DeleteSession(r.Context(), c.Value); err != nil {
				s.logger.Warn("session delete failed", "err", err)
			}
		}
		http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1})
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	mux.HandleFunc("GET /api/me", func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.currentUser(r)
		if !ok {
			writeJSON(w, http.StatusOK, map[string]interface{}{"authenticated": false, "vip": false})
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"authenticated":  true,
			"vip":            isVIP(user),
			"telegram_id":    user.TelegramID,
			"username":       user.Username,
			"tier":           user.Tier,
			"vip_expires_at": user.VIPExpiresAt,
		})
	})

	mux.HandleFunc("GET /api/billing/plan", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"price_usd": s.cfg.VIPPriceUSD,
			"days":      s.cfg.VIPPlanDays,
			"network":   s.cfg.PaymentNetwork,
			"asset":     "USDT",
			"enabled":   s.cfg.PaymentsEnabled(),
		})
	})

	// Creates (or returns) the open invoice: a unique USDT amount to send.
	mux.HandleFunc("POST /api/billing/invoice", func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.currentUser(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "sign in with Telegram to continue"})
			return
		}
		if !s.cfg.PaymentsEnabled() {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "payments are not configured yet"})
			return
		}
		if inv, found, err := s.pg.OpenInvoice(r.Context(), user.TelegramID); err != nil {
			s.fail(w, err)
			return
		} else if found {
			writeJSON(w, http.StatusOK, inv)
			return
		}

		inv, err := s.pg.CreateInvoice(r.Context(), user.TelegramID, "vip_monthly", s.cfg.VIPPlanDays,
			s.cfg.VIPPriceUSD, s.cfg.PaymentNetwork, s.cfg.PaymentAddress, s.cfg.InvoiceTTL)
		if errors.Is(err, store.ErrNoInvoiceSlot) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "too many open invoices, try again in a few minutes"})
			return
		}
		if err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, inv)
	})

	mux.HandleFunc("GET /api/billing/invoices", func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.currentUser(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "sign in with Telegram to continue"})
			return
		}
		rows, err := s.pg.UserInvoices(r.Context(), user.TelegramID, intParam(r.URL.Query().Get("limit"), 20))
		if err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	})
}
