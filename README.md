# Hitchedarc
Static site + Vercel function `api/quote`. No build step.
- Vercel: Framework **Other**, no build command, output = root.
- Env: `RESEND_API_KEY`, `RESEND_FROM`, `QUOTE_TO_EMAIL`, `ALERT_SMS_EMAIL` (optional Twilio: `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`, `ALERT_PHONE`).
- Photos: put files in `/photos`, list them in `gallery.js`.
- Placeholders: search `[CITY` and `[XX]` in index.html.
