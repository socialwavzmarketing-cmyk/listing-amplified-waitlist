# Listing Amplified Waitlist Integration Setup

## What this does
- Submits the original waitlist form to a Vercel serverless route: `/api/waitlist-submit`
- Upserts the contact into GCC (`/api/ai/contacts`)
- Applies these GCC tags:
  - Listing Amplified
  - Founding Agent Program
  - Early Access
  - Waitlist
  - Referral Interest
  - Partnero Manual Referral Setup
- Redirects the visitor to `thank-you.html`
- If GCC sync fails, the route still returns success and logs the failed sync for retry through Control Board **when** `CONTROLBOARD_API_TOKEN` is configured

## Required deployment environment variables
Set these in the Vercel project for `listing-amplified-waitlist`:

- `GLOBAL_CONTROL_API_KEY`
  - or `GCC_API_KEY`
  - Value: the Global Control API key
- `CONTROLBOARD_API_TOKEN` *(recommended)*
  - Used for durable submission logging + retry records in Control Board Ideas

## API endpoints used
### GCC
- `GET /api/ai/contacts?search=<email>`
- `GET /api/ai/contacts/:id`
- `POST /api/ai/contacts`
- `PUT /api/ai/contacts/:id`
- `GET /api/ai/tags?limit=2000`
- `POST /api/ai/tags`

### Control Board
- `GET /api/ideas`
- `POST /api/ideas`
- `PUT /api/ideas`

## Tags created in GCC
Tag group:
- `Listing Amplified` → `6a0c9e30923e612330369d32`

Tags:
- `Listing Amplified` → `6a0c9e38923e612330369dfa`
- `Founding Agent Program` → `6a0c9e38923e612330369eae`
- `Early Access` → `6a0c9e38923e612330369f62`
- `Waitlist` → `6a0c9e38923e61233036a016`
- `Referral Interest` → `6a0c9e38923e61233036a0ca`
- `Partnero Manual Referral Setup` → `6a0c9e38923e61233036a17e`

## Current fallback behavior
If `GLOBAL_CONTROL_API_KEY` is missing in Vercel:
- the form still gets a successful response from the API route
- the visitor still reaches the thank-you page
- GCC sync is skipped
- the response includes a config-needed marker

If `CONTROLBOARD_API_TOKEN` is missing in Vercel:
- GCC sync can still work
- durable local submission logging / retry logging is not available yet
- failed sync attempts will only appear in function logs until the token is added

## Future developer note
Referral links are still manual for now. Partnero referral links can later be automated through hosted Partnero signup, API, webhook, or email-based onboarding.
