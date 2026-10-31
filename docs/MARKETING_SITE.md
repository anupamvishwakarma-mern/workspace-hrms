# Marketing website (`apps/marketing`)

A separate Next.js 16 app (App Router, TypeScript, Tailwind v4) that markets the HRMS, collects leads and hands trial sign-ups to the **existing** HRMS API. It adds no users, tenants or authentication of its own, and does not touch `apps/web`, `apps/api` or `apps/mobile`. There is no `packages/` directory: it is one more app in the `apps/*` workspace.

Why a separate app: `apps/web` owns `/` (it redirects to the dashboard), has its own strict CSP and teal design tokens, and serves authenticated pages. A marketing site needs public pages, different tokens and a different CSP, so mixing them would risk the HRMS routes.

## Run

```powershell
pnpm install
copy apps\marketing\.env.example apps\marketing\.env.local
pnpm --filter @workforce/marketing dev      # http://localhost:3001
pnpm --filter @workforce/marketing build
pnpm --filter @workforce/marketing start
pnpm --filter @workforce/marketing test
```

## Where things live

| What                                                                                  | Where                                                                                                          |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Brand name, tagline, colours, contact, social links                                   | `src/config/brand.ts` (+ `NEXT_PUBLIC_BRAND_*`). CSS tokens mirror the colours in `src/app/globals.css`.       |
| Base URL, app/login/trial/demo URLs                                                   | `src/config/site.ts`                                                                                           |
| Plans, prices, annual discount, GST, add-ons, hosting commercial rules, billing terms | `src/config/pricing.ts` (`illustrative: true` shows an "illustrative" banner everywhere; set false when final) |
| Product modules (what exists vs `comingSoon`)                                         | `src/config/features.ts`                                                                                       |
| Solutions, services, FAQs, navigation                                                 | `src/config/{solutions,services,faqs,navigation}.ts`                                                           |
| Blog posts, guides, templates                                                         | `src/content/` (sample content, clearly labelled)                                                              |
| Downloadable templates                                                                | `public/templates/` (only files that really exist are listed)                                                  |
| SEO helpers                                                                           | `src/lib/seo/metadata.ts`, `sitemap.ts`, `robots.ts`, `opengraph-image.tsx`                                    |
| Public API routes                                                                     | `src/app/api/{trial,demo,leads/*,newsletter,newsletter/unsubscribe}`                                           |

To move content to a CMS later, replace the arrays in `src/config` and `src/content` with fetchers in `src/lib/integrations/` that return the same types. Components do not need to change.

## Pages

`/`, `/features` (+10 feature pages), `/solutions` (+10), `/services`, `/pricing`, `/database-hosting`, `/about`, `/contact`, `/book-demo`, `/free-trial`, `/resources`, `/resources/hr-templates`, `/blog`, `/blog/[slug]` (10 sample posts), `/guides`, `/faq`, `/partners`, `/tools/hrms-roi-calculator`, `/tools/employee-cost-calculator`, `/unsubscribe`, and legal / placeholder pages (`/privacy-policy`, `/terms`, `/cookie-policy`, `/data-processing-agreement`, `/integrations`, `/careers`, `/documentation`, `/help-center`).

## Integrations and what is real

| Flow                                                         | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                        | Needs                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Free trial** `/free-trial` -> `POST /api/trial`            | Validated server-side, then forwarded to the existing `POST {API_ORIGIN}/api/v1/signup` (managed or customer-owned). Success is shown **only** after a `201` from that API. States: in progress, created, validation error, existing account, database verification error, signup closed, failed. The customer connection string goes server-to-server only: never logged, never stored in the browser, never sent to analytics, never echoed back. | `API_ORIGIN`; the API must have `PUBLIC_SIGNUP_ENABLED=true`. No CORS change is needed on the API: the browser calls this site, which calls the API server-side.                                                                                                                                                                                                                                                   |
| **Demo, contact, service, partner, newsletter, unsubscribe** | Validated, rate limited, delivered to `LEAD_WEBHOOK_URL` (HTTPS, optional HMAC signature `X-Signature-256`). In development without a webhook, leads are appended to `.data/leads.jsonl`. In production without a webhook the API answers **503** and the form says so: it never pretends.                                                                                                                                                          | A CRM/automation endpoint that accepts the JSON `{kind, receivedAt, data, ip}`.                                                                                                                                                                                                                                                                                                                                    |
| **Payments**                                                 | None. Pricing is estimate-only; plan buttons lead to the trial or to sales. **TODO** when a gateway is chosen: add a server route that creates a checkout session with a secret key held only in server env, and redirect to it. Do not collect card details on this site.                                                                                                                                                                          | A verified payment provider.                                                                                                                                                                                                                                                                                                                                                                                       |
| **Analytics**                                                | Off by default. With `NEXT_PUBLIC_ANALYTICS_PROVIDER=plausible                                                                                                                                                                                                                                                                                                                                                                                      | ga4` and an id, the script loads only after the visitor clicks Accept. Events (`hero_trial_click`, `hero_demo_click`, `pricing_plan_select`, `pricing_calculator_use`, `database_hosting_view`, `demo_form_submit`, `trial_registration_start`, `trial_registration_success`, `newsletter_signup`) carry only allow-listed non-personal properties. The CSP allows the provider's host only when it is configured. | Provider account. |
| **Login / activation**                                       | Links to `{NEXT_PUBLIC_APP_URL}/login` and, in non-production when email is disabled, the activation path returned by the API. In production the owner gets the activation email from the API.                                                                                                                                                                                                                                                      | `NEXT_PUBLIC_APP_URL`, API email configured.                                                                                                                                                                                                                                                                                                                                                                       |

## Security

- Zod validation on every route (same schemas as the forms); generic safe error messages; request bodies are never logged.
- Per-IP rate limit, request size cap, same-origin check, honeypot field and minimum fill time on every public POST.
- The in-memory limiter protects one instance; with several instances add an edge/WAF limit.
- Security headers in `next.config.ts` (CSP, HSTS in production, nosniff, frame deny, referrer and permissions policies, COOP). Fonts are self-hosted (`src/app/fonts`, Inter, SIL OFL), so no third-party font request.
- No secrets in `NEXT_PUBLIC_*`. No certification (SOC 2, ISO 27001, GDPR) is claimed anywhere.
- Legal pages are **drafts for legal review**, labelled as such on the page.

## Truthfulness rules (keep them)

- `features.ts` `capabilities` must describe what the app does **today**; unbuilt items go in `comingSoon`. Performance management is shown as "Coming soon" with no capabilities. A test enforces that upcoming modules list none.
- No customer logos, testimonials, statistics, awards, founding year or team size appear. Mockups are labelled "Illustrative interface with sample data". About-us text is placeholder copy.
- Prices are illustrative until `pricingConfig.illustrative` is set to false.

## Placeholders remaining

Brand name and logo, contact details and social links, real pricing and commercial rules, About-us story, blog/guide content (sample), legal documents, documentation and help-centre content, careers, partner commercial terms, real product screenshots (mockups are used instead), payment checkout, CRM webhook, analytics account.

## Deployment

Build with `pnpm --filter @workforce/marketing build` and run `next start -p 3001` (or any Node host). Set `NEXT_PUBLIC_SITE_URL` to the final https origin **at build time** (it feeds canonical URLs and the sitemap). Put it on its own host (e.g. `www.example.com`) and keep the HRMS app on another (e.g. `app.example.com`); set `NEXT_PUBLIC_APP_URL` accordingly.

## Verification done

`tsc` clean, `next build` (62 static/dynamic routes), 25 unit tests (pricing maths, ROI, validation, rate limiter, analytics sanitising, lead delivery honesty, trial hand-off mapping, content integrity), all 56 sitemap URLs return 200 with one `h1`, unique title, canonical and description, no broken internal links, no horizontal overflow at 390 px and 1100/1280 px, light and dark themes, route smoke test, and form API checks against a stand-in signup server. **Not done:** a run against the real HRMS API and a real MongoDB, a screen-reader audit, Lighthouse scores, and cross-browser testing beyond Chromium.
