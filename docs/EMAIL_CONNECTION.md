# Connect your email

Builders can send their quotes, invoices, variations and payment reminders from
their **own** mailbox instead of the shared AI QS account.

| | Without a connection (default) | With a connection |
|---|---|---|
| From | `Gormley Property Solutions <hello@…shared…>` | `Gormley Property Solutions <stephen@gormley.co.uk>` |
| Replies | Reply-To set to the builder's login email | Straight back to the connected mailbox |
| Sent folder | The shared account's | The builder's own |
| Daily sending limit | Shared by every builder | The builder's own Gmail / Outlook limit |

The builder connects on **Branding → Sending email** (`/branding`), sends
themselves a test, and from then on every builder-branded email uses their
mailbox. The estimate send dialog shows which address an email will come from.

Code: `server/emailConnection.js` (OAuth, token storage, sending),
`server/emailConnectionRoutes.js` (`/api/email-connection/*`),
`server/mailer.js` (picks the route), `src/components/EmailSenderCard.js`.

## What goes through the builder's mailbox

Everything `mailer.sendMail()` sends **without** `platform: true`:
quote and estimate sends (including MAX's), invoice sends, invoice chasers,
automatic payment reminders, variation sends and the accountant export.

Platform mail (`platform: true`), meaning acceptances, questions, credit
alerts and admin notices, always uses the shared account.

## When the connected mailbox fails

The email is sent through the shared account instead, so the client still gets
it. If the failure means the connection is dead (access revoked, password
changed, permission removed), the connection is marked `needs_reconnect`, the
builder gets **one** email asking them to reconnect, and the Branding page shows
a Reconnect button. Rate limits and outages are treated as passing failures:
that one email falls back and the connection stays on.

`mail_log.sent_via` records the route for every send: `google`, `microsoft` or
`shared`. A fallback is logged with the reason in `mail_log.error`.

## Security

* **Send-only scopes.** Gmail `gmail.send`, Microsoft Graph `Mail.Send`. The
  portal cannot read anyone's inbox.
* **Tokens are encrypted at rest** with AES-256-GCM. The key is `EMAIL_TOKEN_KEY`,
  or is derived from `JWT_SECRET` when that is unset. Changing the key means
  builders need to reconnect. Nothing else breaks.
* **The connect must finish in the browser that started it.** `/connect` sets
  the PKCE verifier as an httpOnly cookie on the builder's signed-in browser,
  and the callback refuses to finish without it. A builder therefore cannot
  send someone else a connect link to attach *that person's* mailbox to their
  own account.
* **Disconnect** deletes the tokens and revokes the grant at Google. Microsoft
  has no per-app revoke API; the builder can remove "AI QS" at
  account.microsoft.com → Privacy → Apps and services.

## Setting up Gmail / Google Workspace

The existing Google sign-in client (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`)
is reused with one more scope. To use a separate Google Cloud client for mail,
set `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` instead.

1. **Google Cloud console**: open the project that holds the sign-in client.
2. **APIs & Services → Library**: enable the **Gmail API**.
3. **Google Auth Platform → Clients**: open the web client and add the
   authorised redirect URI
   `https://aiqs-portal.onrender.com/api/email-connection/callback/google`
   (in general `<PORTAL_BASE_URL>/api/email-connection/callback/google`).
4. **Google Auth Platform → Data access**: add the scope
   `https://www.googleapis.com/auth/gmail.send`. Google lists it as *sensitive*.
5. **Google Auth Platform → Audience**:
   * **Testing**: only the test users you list (up to 100) can connect, and
     Google expires their access **after 7 days**, so the connection breaks
     weekly. Fine for trying it out with a few builders.
   * **In production**: submit the app for **verification** (Branding page →
     verification). Google wants a homepage and privacy policy on a domain you
     have verified in Search Console, a short demo video of the connect and
     send, and a sentence on why you need `gmail.send`. Until it is verified,
     builders see a "Google hasn't verified this app" warning and at most 100
     can connect. `gmail.send` is sensitive, not restricted, so no paid
     security assessment is needed.
   * Verification checks that the domains you send people to are ones you own.
     If `onrender.com` causes trouble there, put the portal on your own domain
     (e.g. `portal.theaiqs.com`), update `PORTAL_BASE_URL` and the redirect URI.

## Setting up Outlook / Microsoft 365

1. **entra.microsoft.com → App registrations → New registration**.
   * Supported account types: **Accounts in any organizational directory and
     personal Microsoft accounts** (Microsoft 365 *and* outlook.com / hotmail).
   * Redirect URI: **Web**,
     `https://aiqs-portal.onrender.com/api/email-connection/callback/microsoft`.
2. **Overview**: copy the *Application (client) ID* into `MICROSOFT_CLIENT_ID`.
3. **Certificates & secrets → New client secret**: copy the *Value* into
   `MICROSOFT_CLIENT_SECRET`. Secrets expire (24 months at most), so put a
   reminder in the diary. When it expires, connections stop until a new
   secret is set.
4. **API permissions → Microsoft Graph → Delegated**: add `Mail.Send`,
   `User.Read`, `offline_access`, `openid`, `email`. None of them need admin
   consent, but some companies block staff from approving apps from
   unverified publishers. Their IT admin can approve it, or you can complete
   **Publisher verification** (needs a Microsoft Partner Network ID).

## Environment variables

| Variable | Needed for | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Gmail | Already set for Google sign-in |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` | Gmail (optional) | A separate Google client just for mail |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Outlook | From the Entra app registration |
| `EMAIL_TOKEN_KEY` | Both (recommended) | 32+ random characters. Falls back to `JWT_SECRET` |
| `PORTAL_BASE_URL` | Both | Already set; the redirect URIs are built from it |

A provider's button only appears once its two variables are set.

## The iOS and Android app

Google refuses sign-in inside an app's web view, and the connect must finish in
the browser that started it. So in the app the card shows **Connect on the
website**, which opens the portal in the in-app browser, and re-checks the
status when that browser closes. Once connected, the app's emails use the
mailbox like everything else: the connection lives on the server.

## Local development

Set `PORTAL_BASE_URL=http://localhost:3000` (the CRA dev server proxies `/api`
to the Express server) and add
`http://localhost:3000/api/email-connection/callback/google` (and/or
`…/microsoft`) as a redirect URI on the provider. The cookie is not marked
`Secure` outside production, so plain `http://localhost` works.

Tests: `node --test server/emailConnection.test.js`. Google, Microsoft and SMTP
are all scripted, so no accounts are needed.
