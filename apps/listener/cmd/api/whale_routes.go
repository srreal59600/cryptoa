package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// pnlWindow is the horizon of the wallet profit/loss figures served to VIPs.
const pnlWindow = 30 * 24 * time.Hour

// whaleRoutes exposes the tracked big accounts, their 30-day result and the
// per-user watchlist that drives personal Telegram notifications.
func (s *server) whaleRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/whales", s.vipOnly(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		rows, err := s.pg.ListWhaleAccounts(r.Context(),
			uint64(intParam(q.Get("chain_id"), 0)), intParam(q.Get("limit"), 50))
		if err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}))

	mux.Handle("GET /api/whales/pnl", s.vipOnly(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		address := strings.TrimSpace(q.Get("address"))
		if address == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "address is required"})
			return
		}
		pnl, err := s.pg.WalletPnLWindow(r.Context(), uint64(intParam(q.Get("chain_id"), 0)), address, pnlWindow)
		if err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, pnl)
	}))

	mux.Handle("GET /api/watchlist", s.vipOnly(func(w http.ResponseWriter, r *http.Request) {
		user, _ := s.currentUser(r)
		items, err := s.pg.ListWatchlist(r.Context(), user.TelegramID)
		if err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, items)
	}))

	mux.Handle("POST /api/watchlist", s.vipOnly(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ChainID uint64 `json:"chain_id"`
			Address string `json:"address"`
			Label   string `json:"label"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !strings.HasPrefix(body.Address, "0x") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a 0x address is required"})
			return
		}
		if body.ChainID == 0 {
			body.ChainID = 1
		}
		kind := "token"
		if len(body.Address) == 42 {
			kind = "wallet"
		}
		user, _ := s.currentUser(r)
		if err := s.pg.AddWatch(r.Context(), user.TelegramID, body.ChainID, kind, body.Address, body.Label); err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "watching"})
	}))

	mux.Handle("DELETE /api/watchlist", s.vipOnly(func(w http.ResponseWriter, r *http.Request) {
		user, _ := s.currentUser(r)
		n, err := s.pg.RemoveWatch(r.Context(), user.TelegramID, r.URL.Query().Get("address"))
		if err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]int64{"removed": n})
	}))
}
