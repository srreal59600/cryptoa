package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"
	"testing"
	"time"
)

const testBotToken = "123456:test-token"

func signedLogin(t *testing.T, authDate int64) telegramLogin {
	t.Helper()
	login := telegramLogin{ID: 42, FirstName: "Gorkem", Username: "gorkem", AuthDate: authDate}

	data := strings.Join([]string{
		"auth_date=" + strconv.FormatInt(authDate, 10),
		"first_name=Gorkem",
		"id=42",
		"username=gorkem",
	}, "\n")
	secret := sha256.Sum256([]byte(testBotToken))
	mac := hmac.New(sha256.New, secret[:])
	mac.Write([]byte(data))
	login.Hash = hex.EncodeToString(mac.Sum(nil))
	return login
}

func TestVerifyAcceptsFreshSignature(t *testing.T) {
	login := signedLogin(t, time.Now().Unix())
	if err := login.verify(testBotToken); err != nil {
		t.Fatalf("expected valid login, got %v", err)
	}
}

func TestVerifyRejectsTamperedPayload(t *testing.T) {
	login := signedLogin(t, time.Now().Unix())
	login.ID = 43
	if err := login.verify(testBotToken); err == nil {
		t.Fatal("expected signature mismatch for tampered id")
	}
}

func TestVerifyRejectsStaleLogin(t *testing.T) {
	login := signedLogin(t, time.Now().Add(-48*time.Hour).Unix())
	if err := login.verify(testBotToken); err == nil {
		t.Fatal("expected expired login to be rejected")
	}
}

func TestVerifyRequiresBotToken(t *testing.T) {
	login := signedLogin(t, time.Now().Unix())
	if err := login.verify(""); err == nil {
		t.Fatal("expected missing bot token to fail")
	}
}
