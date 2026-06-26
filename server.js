#!/usr/bin/env node
/**
 * LessonLight MVP — Bible-lesson generator for teachers (Leo, 2026-06-14 night).
 * Serves a form + POST /api/generate which calls OpenAI (gpt-4o-mini) with a
 * pedagogy-structured prompt and returns a complete, printable lesson.
 * Key from secrets/openai.env. Run:  node drafts/apps/lessonlight/server.js
 *
 * PAYMENTS (Stripe, added 2026-06-15): one-time unlock via Stripe Checkout.
 *   - GRACEFUL: with NO Stripe key, the app runs fully FREE (demo mode) — unchanged.
 *   - With a Stripe key (secrets/stripe.env), generation is gated behind a paid
 *     one-time unlock. No SDK — native fetch against the Stripe REST API.
 *   secrets/stripe.env:  STRIPE_SECRET_KEY=sk_test_... [STRIPE_PRICE_CENTS=700]
 *                        [STRIPE_PRODUCT_NAME=...] [APP_URL=http://localhost:8095]
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const PORT = process.env.PORT || 8095;

// ---- config loaders (secrets/*.env) -------------------------------------
function loadEnv(file) {
    const out = {};
    try {
        const env = fs.readFileSync(path.join(ROOT, 'secrets', file), 'utf8');
        for (const line of env.split('\n')) {
            const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
            if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
    } catch {}
    return out;
}
const openaiEnv = loadEnv('openai.env');
let OPENAI_KEY = process.env.OPENAI_API_KEY || openaiEnv.OPENAI_API_KEY || '';
let OPENAI_MODEL = process.env.OPENAI_MODEL || openaiEnv.OPENAI_MODEL || 'gpt-4o-mini';

const stripeEnv = loadEnv('stripe.env');
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || stripeEnv.STRIPE_SECRET_KEY || '';
const PRICE_CENTS = parseInt(process.env.STRIPE_PRICE_CENTS || stripeEnv.STRIPE_PRICE_CENTS || '700', 10);
const PRODUCT_NAME = process.env.STRIPE_PRODUCT_NAME || stripeEnv.STRIPE_PRODUCT_NAME || 'LessonLight — unlimited lessons';
const APP_URL = (process.env.APP_URL || stripeEnv.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const STRIPE_ON = !!STRIPE_KEY;

// in-memory set of session_ids we've already verified as paid (avoids re-hitting
// Stripe on every generate). Cleared on restart — fine for an unlock token.
const paidSessions = new Set();

// ---- Stripe REST helpers (no SDK; form-encoded) -------------------------
function formEncode(obj, prefix, out) {
    out = out || new URLSearchParams();
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}[${k}]` : k;
        if (v && typeof v === 'object') formEncode(v, key, out);
        else out.append(key, String(v));
    }
    return out;
}
async function stripePost(pathname, params) {
    const res = await fetch('https://api.stripe.com/v1' + pathname, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formEncode(params).toString(),
    });
    const j = await res.json();
    if (!res.ok) throw new Error('Stripe ' + res.status + ': ' + (j.error?.message || JSON.stringify(j)).slice(0, 200));
    return j;
}
async function stripeGet(pathname) {
    const res = await fetch('https://api.stripe.com/v1' + pathname, {
        headers: { 'Authorization': 'Bearer ' + STRIPE_KEY },
    });
    const j = await res.json();
    if (!res.ok) throw new Error('Stripe ' + res.status + ': ' + (j.error?.message || JSON.stringify(j)).slice(0, 200));
    return j;
}
async function createCheckout() {
    const session = await stripePost('/checkout/sessions', {
        mode: 'payment',
        success_url: APP_URL + '/?paid={CHECKOUT_SESSION_ID}',
        cancel_url: APP_URL + '/',
        line_items: { 0: {
            quantity: 1,
            price_data: { currency: 'usd', unit_amount: PRICE_CENTS, product_data: { name: PRODUCT_NAME } },
        } },
    });
    return session.url;
}
async function sessionIsPaid(sessionId) {
    if (!sessionId) return false;
    if (paidSessions.has(sessionId)) return true;
    const s = await stripeGet('/checkout/sessions/' + encodeURIComponent(sessionId));
    const ok = s.payment_status === 'paid';
    if (ok) paidSessions.add(sessionId);
    return ok;
}

// ---- lesson generation ---------------------------------------------------
const SYSTEM = `You are an expert Christian curriculum designer with a background in K-12 education and instructional design. You write complete, age-appropriate, pedagogically sound Bible lessons that a teacher can pick up and teach immediately. You are doctrinally careful and broadly evangelical; you adapt tone to the denomination/notes the teacher gives and never push contested doctrine. You write warmly and clearly for real classrooms.`;

function buildPrompt({ age, passage, length, tone, size }) {
    return `Create a complete Bible lesson.

Age group: ${age || 'elementary (6-10)'}
Passage or topic: ${passage || "teacher's choice from the Gospels"}
Lesson length: ${length || '30 minutes'}
Class size: ${size || 'small (5-12)'}
Tone / denomination notes: ${tone || 'broadly evangelical; keep it warm and non-contentious'}

Return the lesson in clean Markdown with EXACTLY these sections, in order:
## Lesson Title
## Objective  (one sentence)
## Opening Hook  (a 2-3 minute icebreaker or question)
## The Story  (the passage retold age-appropriately, vivid but faithful)
## Discussion Questions  (5-6, ordered easy -> deeper, suited to the age)
## Activity / Craft  (one hands-on activity with a short materials list)
## Memory Verse  (verse + reference + a simple way to memorize it)
## Take-Home Note  (2-3 sentences for parents)

Keep it practical and ready to teach. No preamble, start at "## Lesson Title".`;
}

async function generate(input) {
    if (!OPENAI_KEY) throw new Error('No OpenAI key found (secrets/openai.env).');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENAI_KEY },
        body: JSON.stringify({
            model: OPENAI_MODEL,
            messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: buildPrompt(input) }],
            temperature: 0.7,
        }),
    });
    if (!res.ok) throw new Error('OpenAI ' + res.status + ': ' + (await res.text()).slice(0, 200));
    const j = await res.json();
    return j.choices?.[0]?.message?.content || '(no content)';
}

// ---- helpers -------------------------------------------------------------
function readBody(req) { return new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); }); }
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, APP_URL);

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
        return;
    }

    // tell the client whether payments are on + the price (for the paywall UI)
    if (req.method === 'GET' && url.pathname === '/api/config') {
        return json(res, 200, { stripe: STRIPE_ON, priceCents: PRICE_CENTS, priceLabel: '$' + (PRICE_CENTS / 100).toFixed(2), product: PRODUCT_NAME });
    }

    // start a Stripe Checkout session -> returns the hosted-checkout URL
    if (req.method === 'POST' && url.pathname === '/api/checkout') {
        if (!STRIPE_ON) return json(res, 400, { ok: false, error: 'payments not configured yet' });
        try { return json(res, 200, { ok: true, url: await createCheckout() }); }
        catch (e) { return json(res, 500, { ok: false, error: e.message }); }
    }

    // verify an unlock after returning from Stripe (?paid=session_id)
    if (req.method === 'GET' && url.pathname === '/api/unlock-status') {
        if (!STRIPE_ON) return json(res, 200, { paid: true, demo: true });
        try { return json(res, 200, { paid: await sessionIsPaid(url.searchParams.get('session_id')) }); }
        catch (e) { return json(res, 500, { paid: false, error: e.message }); }
    }

    if (req.method === 'POST' && url.pathname === '/api/generate') {
        try {
            const input = JSON.parse((await readBody(req)) || '{}');
            // paywall: only enforced when Stripe is configured. Free demo otherwise.
            if (STRIPE_ON && !(await sessionIsPaid(input.session_id))) {
                return json(res, 402, { ok: false, error: 'payment required', needUnlock: true });
            }
            const lesson = await generate(input);
            return json(res, 200, { ok: true, lesson });
        } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
    }


    // ---- static assets (SEO): og image, crawler files ----
    if (req.method === 'GET' && ['/og.png','/robots.txt','/sitemap.xml','/favicon.ico'].includes(url.pathname)) {
        const map = { '/og.png':'image/png', '/robots.txt':'text/plain', '/sitemap.xml':'application/xml', '/favicon.ico':'image/png' };
        const fp = path.join(__dirname, url.pathname === '/favicon.ico' ? 'og.png' : url.pathname.slice(1));
        try { const buf = fs.readFileSync(fp); res.writeHead(200, { 'Content-Type': map[url.pathname], 'Cache-Control':'public, max-age=86400' }); res.end(buf); return; }
        catch { /* fall through to 404 */ }
    }

    res.writeHead(404); res.end('not found');
});

server.listen(PORT, () => console.log(
    `[LessonLight] http://localhost:${PORT}  (model ${OPENAI_MODEL}, openai ${OPENAI_KEY ? 'loaded' : 'MISSING'}, ` +
    `payments ${STRIPE_ON ? 'ON $' + (PRICE_CENTS / 100).toFixed(2) : 'OFF (free demo)'})`));
