# LessonLight — Launch Checklist
_Prepped by Athena 2026-06-24 while Leo was out. Everything below the "DONE" line is verified working._

## ✅ DONE (Athena, autonomous — no accounts needed)
- **Core proven** — generates a complete, quality Bible lesson (tested live: full Good Samaritan lesson, all 8 sections). OpenAI `gpt-4o-mini`, key works (`secrets/openai.env`).
- **Stripe paid flow built + proven (TEST mode)** — `/api/checkout` creates a real Stripe hosted-checkout session; generation is correctly paywalled (HTTP 402) until paid. $7 price wired.
- **Landing page ready** — hero, all inputs (age, passage, length, class size, tone/denomination), Generate + Unlock + Print-PDF + Copy buttons, mobile viewport.
- **Deploy-ready** — `render.yaml` present; standalone git repo committed (only 5 source files; secrets + node_modules excluded). Ready to push.
- Running locally on :8095 with test Stripe ON.

## ⬜ LEO'S PART (when home — ~15 min, I'll walk you through each)
1. **Deploy (pick one):**
   - **Render (recommended):** sign into GitHub once → I push this repo → connect it to Render (free tier) → it auto-builds from `render.yaml`. *(GitHub sign-in is the one-time hurdle.)*
   - **Fly.io (skips GitHub):** install `flyctl`, sign in, `fly deploy` from this folder. No GitHub, but Fly wants a card on file.
2. **Set env vars on the host** (render.yaml lists them, all `sync:false` = you enter them):
   - `OPENAI_API_KEY` = the working key
   - `STRIPE_SECRET_KEY` = **your LIVE key** (`sk_live_…`, NOT the test one)
   - `STRIPE_PRICE_CENTS` = your price (see #3)
   - `APP_URL` = the deployed URL Render gives you
3. **Price decision** — ⚠️ *business note:* it's currently **$7 one-time for "unlimited lessons,"** which is underpriced (a teacher gets infinite lessons forever for $7). Consider **$7/month**, or **$7 per lesson-pack**, or a higher one-time. (Monthly = recurring = clear it with April first.)
4. **Flip live** — once the LIVE Stripe key is set (step 2), it's taking real money. Test one real $X purchase yourself first.
5. **First customers** — put the live URL in front of the Raven Arts church / Sunday-school contacts.

## Notes
- Local instance uses TEST Stripe (`secrets/stripe.env`) — that's just for proving the flow. Production keys live ONLY in the host's env vars, never committed.
- Stripe account = Studio Beltran (LIVE, activated 2026-06-23; still in the 2-3 day review — confirm charges are enabled before relying on live payments).
