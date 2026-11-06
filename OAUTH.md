# External sign-in

Google and Facebook are optional. Email/password sign-in does not require provider
credentials. Unconfigured providers redirect to the sign-in screen with a fixed
message instead of leaving the visitor on an API error page.

## Login attempts and sessions

The start route creates a random 256-bit state, stores it in the current server
session and saves that session before redirecting. The callback consumes and
checks the state before processing a code, denial or provider error. It must match
the same browser session and provider, expire in under ten minutes and be unused.
Starting again replaces the previous attempt for that provider; Google and
Facebook attempts are separate. Invalid callbacks require a fresh start.

The return destination is validated as a relative path on APP_ORIGIN and stored
with the attempt. Provider failures return only known reason codes, never raw
provider errors or tokens. The client keeps this destination when switching to
email sign-in or registration, including after a page reload.

Success uses the same session rotation and one-time guest-cart merge as email
sign-in. Only the selected guest order grants/checkout ownership survive that
rotation; old OAuth attempts and Passport login state do not. Sign-out clears the
login and retains authorized guest access according to the order rules.

## Account identity

An existing (provider, provider ID) pair identifies the existing account. Its email
and identity are not overwritten by later profile responses. Existing links are
preserved, including links created before this change.

A new provider identity cannot attach itself to an account merely by returning
the same email, even if Google verifies it. The user must sign in using the
original method. There is no account-linking UI in this demo. This also prevents
one provider from overwriting the previous provider stored on the account.

New Google identities with an email require Google's verified-email flag.
Facebook may omit an email; those accounts have a null email rather than a
fabricated address. Checkout still requires an email supplied by the visitor.
Unique indexes and conflict recovery prevent concurrent creation of duplicate
provider identities. No data migration or provider credential change is required.

## Deployment configuration

For the existing Netlify proxy, all sign-in traffic must use the same host:

- Client VITE_API_URL: `/api`.
- API APP_ORIGIN: `https://hiking-store-uk.netlify.app`.
- GOOGLE_CALLBACK_URL and the Google authorized redirect URI:
  `https://hiking-store-uk.netlify.app/api/auth/google/callback`.
- FB_CALLBACK_URL and the Facebook valid OAuth redirect URI:
  `https://hiking-store-uk.netlify.app/api/auth/facebook/callback`.
- SESSION_SAME_SITE: `lax` after all session traffic uses this proxy.

Keep production secure cookies enabled; do not configure a cookie domain for the
Render hostname when the browser talks to Netlify. These are configuration
instructions, not changes made by this branch. See STABILIZATION.md for rollout.
Opening through Netlify and returning directly to Render uses different browser
cookies and will correctly fail the state check. Likewise, a missing or blocked
session cannot authorize a callback. Retry from the sign-in page after correcting
configuration; do not disable state verification to mask this problem.

## Verification

`npm test` checks state generation, provider/session binding, expiry, replay and
safe return paths. With TEST_DATABASE_URL, the HTTP suite uses real Passport
strategies and PostgreSQL, mocking only the provider token/profile responses.
It covers success, cancellation, missing cookies, invalid state, provider failure,
unavailable credentials, email collisions, Google email verification, Facebook
without email, concurrent identity creation, session rotation and guest state.

The client browser suite checks error messages and email/registration fallback.
These tests do not sign in to real Google/Facebook accounts or certify provider
dashboards. After deploying, manually check both configured providers, cancellation,
an incognito session with third-party cookies blocked, sign-out/reload and the
guest-order return destination. No credentials or private tokens belong in Git.
