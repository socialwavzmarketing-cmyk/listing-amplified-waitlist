# Listing Amplified Integration Setup

**Last Updated:** 2026-11-04
**Status:** Active and Working

---

## 🎯 Overview

This document describes how **Listing Amplified** integrates with:
- **Global Control (GCC)** — CRM and contact management
- **Partnero** — Referral tracking and affiliate management

---

## 🔗 Global Control (GCC) Integration

### API Details

| Setting | Value |
|---------|-------|
| **Base URL** | `https://api.globalcontrol.io/api/ai` |
| **Auth Header** | `X-API-KEY` (not Bearer token) |
| **API Key** | Stored in `credentials/titanium-api-keys.txt` |
| **Account** | Robin Nelson (PRO) |

### Working Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/ai/users/me` | GET | Verify API key |
| `/api/ai/contacts` | GET | List contacts (paged) |
| `/api/ai/contacts/{id}` | GET | Get one contact |
| `/api/ai/tags/fire` | POST | **Upsert contact + apply tags** |
| `/api/ai/tags` | GET | List all tags |
| `/api/ai/tags` | POST | Create new tag |
| `/api/ai/tag-groups` | GET | List tag groups |

### ❌ Removed/Deprecated Endpoints

| Endpoint | Status | Replacement |
|----------|--------|-------------|
| `PUT /api/ai/contacts/{id}` | **GONE** | Use `POST /api/ai/tags/fire` |
| `POST /api/ai/contacts/{id}` | **GONE** | Use `POST /api/ai/contacts` |
| `DELETE /api/ai/contacts/{id}` | **404** | No replacement (delete in dashboard) |

### Tag Configuration

| Tag | ID | Group ID |
|-----|-----|----------|
| Listing Amplified | `6a0c9e38923e612330369dfa` | `6a0c9e30923e612330369d32` |
| NL-Listing-Amplified | `6a0f234c9623b6235fa8662c` | `673974d6be5eb931a421b251` |
| Amplified Agents Directory | `6a5e9ed7540da5925a3df42e` | `6a0c9e30923e612330369d32` |

### How It Works

```
User submits form
  → POST /api/waitlist-submit
    → GCC sync via POST /api/ai/tags/fire
      → Contact created/updated
      → Tags applied
      → Workflows triggered
    → Response: { ok: true, syncStatus: 'synced' }
```

### Code Location

**File:** `api/waitlist-submit.js`

```javascript
await fetchJson(`${GCC_BASE}/tags/fire`, {
  method: 'POST',
  headers: {
    'X-API-KEY': gccApiKey,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    email: record.email,
    firstName: record.firstName,
    lastName: record.lastName,
    phone: record.phone,
    tagIds: requiredTagIds
  })
});
```

---

## 🤝 Partnero Integration

### Configuration

| Setting | Value |
|---------|-------|
| **Program ID** | `C2WUJDUI` |
| **Script URL** | `https://app.partnero.com/js/universal.js` |
| **Assets Host** | `https://assets.partnero.com` |
| **Integration Type** | Client-side JavaScript only |
| **API Key** | Not stored (not using server API) |

### Files with Partnero

| File | Script Loaded | Signup Call | Purpose |
|------|--------------|-------------|---------|
| `founding-access-form.html` | ✅ | ✅ | Main form — active signup flow |
| `index.html` | ✅ | ❌ | Landing page |
| `thank-you.html` | ✅ | ❌ | Thank you page |
| `directory-founding-access-form.html` | ❌ | ❌ | Larina Matrix — no Partnero |
| `larina-to-la.html` | ❌ | ❌ | Transition page — no Partnero |

### How It Works

```
User visits page with ?ref=abc123
  → PartneroJS loads
    → Detects referral key from URL
    → Sets cookie: partnero_referral=abc123 (30 days)

User submits form
  → GCC sync succeeds
    → Browser calls: window.po('customers', 'signup', {...})
      → Partnero reads cookie
      → Creates referral account
      → Attributes signup to referrer
    → User redirected to thank-you page
```

### Cookie Behavior

| Setting | Value |
|---------|-------|
| **Cookie Name** | `partnero_referral` (or `partnero_partner`) |
| **Expiry** | 30 days (2,592,000 seconds) |
| **SameSite** | `None` |
| **Secure** | `true` (HTTPS only) |
| **Domain** | Root domain (e.g., `.listingamplified.com`) |
| **Attribution** | `last_click` (default) |

### Code Location

**File:** `founding-access-form.html` (lines ~910-925)

```javascript
const partneroName = [payload.firstName, payload.lastName]
  .filter(Boolean)
  .join(' ')
  .trim();

if (typeof window.po === 'function' && payload.email) {
  try {
    window.po('customers', 'signup', {
      data: {
        key: payload.email,
        email: payload.email,
        name: partneroName || null,
        options: {
          integration: 'listing_amplified_waitlist',
          referral_url: window.location.href
        }
      }
    }, 'C2WUJDUI');
  } catch (partneroError) {
    console.error('Partnero signup failed to fire.', partneroError);
  }
}
```

---

## 📊 Integration Matrix

| Page | GCC | Partnero | Notes |
|------|-----|----------|-------|
| `founding-access-form.html` | ✅ | ✅ | Main waitlist form |
| `directory-founding-access-form.html` | ✅ | ❌ | Larina Matrix |
| `larina-to-la.html` | ✅ | ❌ | Transition page |
| `thank-you.html` | ❌ | ✅ | Script loads only |
| `index.html` | ❌ | ✅ | Script loads only |

---

## ⚠️ Known Limitations

### GCC
- **No DELETE endpoint** for contacts (must delete in dashboard)
- **Rate limits** apply (wait between bulk operations)

### Partnero
- **Client-side only** — no server-side backup
- **Silent failures** — if JS fails, user never knows
- **Ad blocker vulnerable** — script may be blocked
- **No retry logic** — if down, signup is lost
- **Cannot test from server** — requires browser context

---

## 🔧 Error Logging

### New Endpoint: `/api/log-error`

**File:** `api/log-error.js`

Logs client-side errors to server for monitoring:

```javascript
// Usage from browser:
fetch('/api/log-error', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'partnero_signup_failed',
    error: error.message,
    email: userEmail,
    timestamp: new Date().toISOString()
  })
});
```

### Current Error Handling

| Scenario | Behavior |
|----------|----------|
| GCC API down | User sees error message |
| GCC succeeds, Partnero fails | User redirected to thank-you (silent) |
| PartneroJS blocked | User redirected to thank-you (silent) |
| JavaScript disabled | Form won't submit |

---

## 🚀 Deployment

### GitHub Repository
- **Repo:** `socialwavzmarketing-cmyk/listing-amplified-waitlist`
- **Token:** Stored in `credentials/github-token.txt`
- **Platform:** Vercel (auto-deploys on push)

### Environment Variables

| Variable | Location | Used By |
|----------|----------|---------|
| `GLOBAL_CONTROL_API_KEY` | Vercel env | `api/waitlist-submit.js` |
| `CONTROLBOARD_API_TOKEN` | Vercel env | `api/waitlist-submit.js` |

---

## 📝 Change History

| Date | Change | Notes |
|------|--------|-------|
| 2026-11-04 | Verified GCC API docs | `tags/fire` is correct endpoint |
| 2026-11-04 | Added error logging | New `/api/log-error` endpoint |
| 2026-11-04 | Documented integration | Created this file |

---

## 🎯 Future Improvements (On Hold)

1. **Server-side Partnero API**
   - Requires Partnero API key from dashboard
   - Would make referral tracking 100% reliable
   - Can be added later without breaking existing flow

2. **Enhanced Monitoring**
   - Dashboard for error rates
   - Alerts for integration failures

3. **Retry Logic**
   - Queue failed Partnero signups
   - Retry with exponential backoff

---

## 📞 Support

If issues arise:
1. Check this documentation first
2. Review error logs (if logging is active)
3. Test GCC API directly using examples above
4. Check Partnero dashboard for referral data

---

*Document maintained by Robin's AI assistant. Last updated 2026-11-04.*
