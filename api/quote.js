// Hitchedarc quote endpoint. All addresses/keys come from env vars only.
const hits = new Map(); // best-effort per-instance rate limit
const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clip = (s, n) => String(s || '').trim().slice(0, n);

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  let d = ''; for await (const c of req) d += c; return JSON.parse(d || '{}');
}

async function resend(payload, fetchImpl) {
  const r = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error('email ' + r.status);
}

async function handler(req, res, fetchImpl = globalThis.fetch) {
  const send = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
  if (req.method !== 'POST') return send(405, { error: 'Use POST.' });

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  if (list.length >= 5) return send(429, { error: 'Too many requests. Please try again later.' });

  let b; try { b = await readJson(req); } catch { return send(400, { error: 'Bad request.' }); }
  if (b.company) return send(200, { ok: true }); // honeypot

  const name = clip(b.name, 80), email = clip(b.email, 120), phone = clip(b.phone, 30),
    job = clip(b.job, 60), desc = clip(b.desc, 3000), where = b.where === 'Mobile' ? 'Mobile' : 'Shop';
  if (!name || !job || !desc || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(400, { error: 'Please fill in name, a valid email, job type and description.' });

  const photos = (Array.isArray(b.photos) ? b.photos : []).slice(0, 3)
    .filter(p => p && /^image\//.test(p.type) && typeof p.data === 'string');
  if (photos.reduce((a, p) => a + p.data.length * 0.75, 0) > 4.2e6) return send(413, { error: 'Photos are too big (4 MB total max).' });

  const { RESEND_API_KEY, RESEND_FROM, QUOTE_TO_EMAIL, ALERT_SMS_EMAIL } = process.env;
  if (!RESEND_API_KEY || !RESEND_FROM || !QUOTE_TO_EMAIL)
    return send(503, { error: "The quote form isn't set up yet. Please try again soon." });

  list.push(now); hits.set(ip, list);
  const html = `<h2>New Hitchedarc quote request</h2><p><b>Name:</b> ${esc(name)}<br><b>Email:</b> ${esc(email)}<br><b>Phone:</b> ${esc(phone) || '-'}<br><b>Job:</b> ${esc(job)}<br><b>Shop or mobile:</b> ${where}</p><p>${esc(desc).replace(/\n/g, '<br>')}</p><p>${photos.length} photo(s) attached.</p>`;
  const sms = `Hitchedarc quote: ${name.slice(0, 40)} - ${job}. Check email.`.slice(0, 159);

  try {
    await resend({
      from: RESEND_FROM, to: [QUOTE_TO_EMAIL], reply_to: email,
      subject: `Hitchedarc quote: ${name} - ${job}`, html,
      attachments: photos.map((p, i) => ({ filename: clip(p.name, 80).replace(/[^\w.\-]/g, '_') || `photo${i + 1}.jpg`, content: p.data })),
    }, fetchImpl);
  } catch (e) { console.error(e.message); return send(502, { error: "Couldn't send right now. Please try again later." }); }

  // Text alert: Twilio if fully configured, else carrier email-to-SMS gateway.
  try {
    const { TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, ALERT_PHONE } = process.env;
    if (TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM && ALERT_PHONE) {
      await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: ALERT_PHONE, From: TWILIO_FROM, Body: sms }).toString(),
      });
    } else if (ALERT_SMS_EMAIL) {
      await resend({ from: RESEND_FROM, to: [ALERT_SMS_EMAIL], subject: '', text: sms }, fetchImpl);
    }
  } catch (e) { console.error('sms', e.message); } // email already sent; don't fail

  return send(200, { ok: true });
}
module.exports = handler;
module.exports.default = handler;
