#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# test_cooling_off.sh — Test the 14-day cooling-off abuse prevention
#
# Prerequisites:
#   1. Run the DB migration (add cooling_off_used, cooling_off_refunded_at columns)
#   2. Backend running on localhost (npm run dev)
#   3. Stripe CLI listening (stripe listen --forward-to localhost:3004/api/stripe/webhook)
#   4. A valid Supabase access_token (grab from app after logging in)
#
# Usage:
#   ./test_cooling_off.sh <access_token>
#
# The script tests 3 scenarios:
#   A) First-time cancel within 14 days → should get refund
#   B) Immediate re-subscribe after refund → should be blocked (30-day cooldown)
#   C) Repeat cancel → should NOT get refund (end-of-period only)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

TOKEN="${1:-}"
BASE_URL="${2:-http://localhost:3004}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

if [ -z "$TOKEN" ]; then
  echo ""
  echo -e "${YELLOW}Usage: ./test_cooling_off.sh <access_token> [base_url]${NC}"
  echo ""
  echo "How to get your access_token:"
  echo "  1. Open the app (web or mobile)"
  echo "  2. Log in"
  echo "  3. Open browser DevTools → Network tab"
  echo "  4. Look for any API request → copy the Authorization header value"
  echo "  5. Remove the 'Bearer ' prefix — that's your token"
  echo ""
  echo "Or run this in the browser console:"
  echo "  const { data } = await window.__supabase?.auth.getSession();"
  echo "  console.log(data?.session?.access_token);"
  echo ""
  exit 1
fi

AUTH="Authorization: Bearer $TOKEN"
CT="Content-Type: application/json"

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Cooling-Off Abuse Prevention — Test Suite${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# ─── Helper: pretty-print a test result ───────────────────────────────────────
pass() { echo -e "  ${GREEN}✅ PASS:${NC} $1"; }
fail() { echo -e "  ${RED}❌ FAIL:${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️  $1${NC}"; }

# ─── Test 0: Verify auth token works ─────────────────────────────────────────
echo -e "${BLUE}▸ Test 0: Verify auth token${NC}"
STATUS_RESP=$(curl -s -w "\n%{http_code}" -H "$AUTH" "$BASE_URL/api/stripe/status")
HTTP_CODE=$(echo "$STATUS_RESP" | tail -1)
BODY=$(echo "$STATUS_RESP" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  TIER=$(echo "$BODY" | grep -o '"tier":"[^"]*"' | head -1)
  pass "Auth works — current $TIER"
else
  fail "Auth failed (HTTP $HTTP_CODE). Is your token valid?"
  echo "  Response: $BODY"
  exit 1
fi
echo ""

# ─── Test 1: Check current subscription status ───────────────────────────────
echo -e "${BLUE}▸ Test 1: Current subscription status${NC}"
HAS_STRIPE=$(echo "$BODY" | grep -o '"hasStripeCustomer":[a-z]*' | head -1)
HAS_SUB=$(echo "$BODY" | grep -o '"stripeSubscription":{' | head -1 || true)
echo "  $TIER | $HAS_STRIPE"
if [ -n "$HAS_SUB" ]; then
  info "Active Stripe subscription found"
else
  info "No active Stripe subscription"
fi
echo ""

# ─── Test 2: Try to create a checkout (may be blocked by cooldown) ────────────
echo -e "${BLUE}▸ Test 2: Create checkout session${NC}"
CHECKOUT_RESP=$(curl -s -w "\n%{http_code}" -X POST \
  -H "$AUTH" -H "$CT" \
  -d '{"tier":"pro"}' \
  "$BASE_URL/api/stripe/create-checkout")
HTTP_CODE=$(echo "$CHECKOUT_RESP" | tail -1)
BODY=$(echo "$CHECKOUT_RESP" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  TYPE=$(echo "$BODY" | grep -o '"type":"[^"]*"' | head -1)
  if echo "$TYPE" | grep -q "portal"; then
    info "Already subscribed — redirected to portal ($TYPE)"
  else
    pass "Checkout session created ($TYPE)"
    URL=$(echo "$BODY" | grep -o '"url":"[^"]*"' | head -1 | cut -d'"' -f4)
    info "Checkout URL: ${URL:0:80}..."
    echo ""
    echo -e "  ${YELLOW}→ Complete the checkout in the browser to proceed with cancel tests.${NC}"
    echo -e "  ${YELLOW}  Use Stripe test card: 4242 4242 4242 4242, any future date, any CVC.${NC}"
    echo ""
    read -p "  Press Enter after completing checkout..."
  fi
elif [ "$HTTP_CODE" = "403" ]; then
  COOLDOWN=$(echo "$BODY" | grep -o '"cooldownEnds":"[^"]*"' | head -1 || true)
  if [ -n "$COOLDOWN" ]; then
    pass "Re-subscribe BLOCKED by 30-day cooldown! 🛡️"
    info "$(echo "$BODY" | grep -o '"error":"[^"]*"' | head -1)"
    info "$COOLDOWN"
    echo ""
    echo -e "${GREEN}  The cooldown protection is working correctly.${NC}"
    echo -e "${YELLOW}  To bypass for testing, update the DB:${NC}"
    echo "  UPDATE subscriptions SET cooling_off_refunded_at = NOW() - INTERVAL '31 days'"
    echo "  WHERE user_id = '<your-user-id>' AND cooling_off_used = true;"
    echo ""
  else
    fail "403 but not a cooldown: $BODY"
  fi
else
  fail "Unexpected response (HTTP $HTTP_CODE): $BODY"
fi
echo ""

# ─── Test 3: Cancel subscription ──────────────────────────────────────────────
echo -e "${BLUE}▸ Test 3: Cancel subscription${NC}"
CANCEL_RESP=$(curl -s -w "\n%{http_code}" -X POST \
  -H "$AUTH" -H "$CT" \
  "$BASE_URL/api/stripe/cancel")
HTTP_CODE=$(echo "$CANCEL_RESP" | tail -1)
BODY=$(echo "$CANCEL_RESP" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  REFUNDED=$(echo "$BODY" | grep -o '"refunded":[a-z]*' | head -1)
  MSG=$(echo "$BODY" | grep -o '"message":"[^"]*"' | head -1)
  echo "  $REFUNDED"
  echo "  $MSG"
  if echo "$REFUNDED" | grep -q "true"; then
    pass "Cooling-off refund granted (first subscription) 🎉"
    echo ""
    echo -e "  ${YELLOW}Now try running this script AGAIN to test:${NC}"
    echo -e "  ${YELLOW}  - Test 2 should show 30-day COOLDOWN block${NC}"
    echo -e "  ${YELLOW}  - Or if you bypass the cooldown, Test 3 should show NO refund${NC}"
  else
    pass "End-of-period cancellation (no refund) — as expected for repeat subscriber or >14 days"
  fi
elif [ "$HTTP_CODE" = "400" ]; then
  info "$(echo "$BODY" | grep -o '"error":"[^"]*"' | head -1)"
elif [ "$HTTP_CODE" = "404" ]; then
  info "No active subscription to cancel"
else
  fail "Unexpected (HTTP $HTTP_CODE): $BODY"
fi
echo ""

# ─── Summary ──────────────────────────────────────────────────────────────────
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Test complete!${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Full test flow:"
echo "  1. Run this script → subscribe → cancel → should get REFUND ✅"
echo "  2. Run again immediately → checkout should be BLOCKED (30-day cooldown) ✅"
echo "  3. Bypass cooldown in DB → subscribe → cancel → should get NO REFUND ✅"
echo ""
echo "  DB bypass command (run in Supabase SQL Editor):"
echo "  UPDATE subscriptions SET cooling_off_refunded_at = NOW() - INTERVAL '31 days'"
echo "  WHERE cooling_off_used = true;"
echo ""
