# KeyBPM API (Cloudflare Worker)

Discord OAuth, HttpOnly sessions, D1 submission queue.

```bash
npm install
npx wrangler d1 create keybpm   # update database_id in wrangler.toml
npx wrangler d1 migrations apply keybpm --local
npx wrangler secret put DISCORD_CLIENT_ID
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put APPLY_TOKEN
npm run dev                     # http://127.0.0.1:8787
```

Set `APP_ORIGIN` and `MOD_DISCORD_IDS` in `wrangler.toml`. Discord redirect URI must match `{Worker origin}/auth/callback`.
