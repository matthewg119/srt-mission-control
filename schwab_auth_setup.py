"""
Schwab OAuth Bootstrap — run ONCE locally to generate token.json.

Prerequisites:
  pip install schwab-py

Usage:
  SCHWAB_API_KEY=your_key SCHWAB_APP_SECRET=your_secret python schwab_auth_setup.py

After running:
  1. Copy the contents of token.json
  2. Add as SCHWAB_TOKEN_JSON env var in Vercel dashboard
  3. Also add SCHWAB_ACCOUNT_HASH (printed by this script)
"""
import schwab
import os
import json

api_key = os.environ["SCHWAB_API_KEY"]
app_secret = os.environ["SCHWAB_APP_SECRET"]

print("Starting Schwab OAuth flow...")
print("A URL will be printed. Open it in your browser, log in, then paste the redirect URL back here.\n")

client = schwab.auth.client_from_manual_flow(
    api_key=api_key,
    app_secret=app_secret,
    callback_url="https://127.0.0.1",
    token_path="./token.json",
)

print("\n✅ token.json created successfully.")

# Print account hash (needed for order placement)
resp = client.get_accounts()
accounts = resp.json()
for acct in accounts:
    hash_val = acct.get("hashValue", "")
    acct_type = acct.get("securitiesAccount", {}).get("type", "")
    is_paper = "paperMoney" in acct.get("securitiesAccount", {})
    print(f"\nAccount: {acct_type} | Hash: {hash_val} | Paper: {is_paper}")

print("\n📋 Next steps:")
print("  1. Copy token.json contents → SCHWAB_TOKEN_JSON in Vercel env vars")
print("  2. Copy the account hash above → SCHWAB_ACCOUNT_HASH in Vercel env vars")
print("  3. Copy SCHWAB_API_KEY and SCHWAB_APP_SECRET to Vercel env vars")

with open("token.json", "r") as f:
    token = json.load(f)
print("\n📄 token.json contents (copy this to SCHWAB_TOKEN_JSON):")
print(json.dumps(token, indent=2))
