# Mobile app (apps/mobile)

Expo SDK 58 · React Native 0.88 · Expo Router · TanStack Query · React Hook Form + Zod · TypeScript (strict).
Employee-facing: sign in, check in/out, breaks, today's summary, history, correction requests, GPS-exception requests.
Managers/HR review requests through the API (dashboard arrives in Phase 5); the app only shows the signed-in person's own data.

## Run it

```powershell
pnpm install
docker compose up -d mongo
pnpm --filter @workforce/api seed
pnpm dev:api
copy apps\mobile\.env.example apps\mobile\.env
pnpm dev:mobile
```

`EXPO_PUBLIC_API_URL` must include `/api/v1`:

| Where the app runs      | URL                                                                    |
| ----------------------- | ---------------------------------------------------------------------- |
| Android emulator        | `http://10.0.2.2:4000/api/v1`                                          |
| Phone on the same Wi-Fi | `http://<PC LAN IP>:4000/api/v1` (allow port 4000 in Windows Firewall) |
| iOS simulator           | `http://localhost:4000/api/v1`                                         |
| Release builds          | `https://...` only. The app refuses plain `http` outside development.  |

Sign in with `asha@demo.test` / `Demo-Pass-12345` (local seed only).
Expo Go may not support the newest SDK on your phone; if it does not, create a development build (`npx expo run:android`).

### Testing check-in locally

The seeded geofence is Bengaluru HQ (12.9716, 77.5946, 150 m radius), so a phone elsewhere will be "outside". Either set the emulator location (Android Studio: Extended controls, Location) to those coordinates, or sign in as `hr@demo.test` in the API (`PATCH /work-locations/:id`) and move the fence to where you are. Testing the outside case is useful too: the app then offers a "send for approval" request with a reason.

## Architecture

- `src/lib/api.ts`: fetch client. Access token is kept **in memory only**; the rotating refresh token is stored with `expo-secure-store` (Keychain/Keystore, this-device-only). On a 401 it refreshes **once, shared by all concurrent requests** (otherwise the server's refresh-token reuse detection would revoke the session), persists the new refresh token before using the new access token, and retries the request once. A network failure while refreshing keeps the user signed in; only a definitive rejection signs them out.
- `X-Tenant-Id` is sent only as a _selector_; the server re-checks membership every request. The company choice is stored, and the query cache is cleared on sign-out and company switch so one company's data never shows in another.
- Every response is parsed with a Zod schema (`src/lib/schemas.ts`); unexpected shapes are rejected.
- `src/lib/punchFlow.ts`: one location reading (foreground, only when a button is tapped) + an idempotency key + the call. After a timeout or network error the **same key** is reused for a retry of the same action within 10 minutes, so a retry cannot double-record (the server returns the original event). Definitive answers clear it.
- The device never decides attendance: the server assigns the time, verifies the geofence and state, and returns the new state. The phone's clock is sent as diagnostics only.
- Times are displayed in the **company/shift timezone** returned by `GET /attendance/me/today`, not the phone's.

## Design system

The app shares the web app's visual language: teal brand (`#0f766e`, `#2dd4bf` in dark mode), slate neutrals, rounded cards with soft shadows, dot-style status badges, avatar initials, and a segmented control. Tokens live in `src/theme.ts` (light/dark follow the OS), reusable pieces in `src/components/ui.tsx`, and tab icons in `src/components/icons.tsx` (drawn with plain Views, so no icon font or SVG dependency). Behaviour, accessibility labels/hints and all `src/lib` logic are unchanged by the redesign.

The Today screen leads with a status card (live session time, large Check in / Check out button), followed by Worked/Breaks tiles, a summary and the day's punches.

## Photo proof and location display

When HR turns on **Require a photo** (Settings), check in and check out first ask for a photo: **Take selfie** (front camera) or **Use back camera**, a preview, then **Confirm**. Break start/end never need one. The flow is: location is read once, the photo is uploaded straight to private storage with a 5-minute signed URL (`POST /attendance/photos`), then the punch is sent with the `photoId`. The server checks the photo belongs to that employee, was uploaded with the declared type and size, and was not used before. The photo is not saved to the gallery.

After a punch the Today screen shows a **Last punch** card (photo, place name, coordinates, accuracy) and each punch in the list has **Location & photo** details. **Open in Maps** hands the coordinates to the phone's own maps app on tap; the app loads no map tiles and calls no map service, so coordinates are not sent to a third party by the app. HR, owners and the employee's direct manager can view a photo (web: attendance details); views by anyone but the employee are audit-logged. Photos are deleted after `PHOTO_RETENTION_DAYS`.

Limits: the camera flow is not tested on a physical device; the in-app preview is a link to the maps app rather than an embedded map; a photo proves little by itself (it can be of anything), so it is one signal alongside the location result.

## Location and privacy

Location is read once per tap (high accuracy, 20 s timeout), never in the background (no background permission is requested on either platform). Coordinates are sent to the API and not logged or stored on the device. Android's "mock location" flag is sent as a risk signal for reviewers; it does not block the punch on the device. A geofence match shows the device _reported_ a position inside the fence. It does not prove the person was there. `deviceId` (Android ID / iOS vendor ID) is sent so reviewers can spot one device used by several people; remove it in `punchFlow.ts` if your policy forbids it.

## Tests

```powershell
pnpm --filter @workforce/mobile test      # client, refresh, idempotency, forms, formatting
pnpm --filter @workforce/api test         # includes tests/mobile-contract.test.ts
```

`mobile-contract.test.ts` runs the real mobile `ApiClient` and schemas against the real API over HTTP (login, token rotation and replay rejection, punches, 202 exceptions, idempotent replay, corrections). `npx expo export` was used to confirm that Android and iOS bundles build.

## Screens (tabs and More)

Tabs: Today, Attendance (month calendar with present/half/absent/leave/holiday colours, day detail, request a correction), Requests, **Team** (only for managers, HR and owners; status filters, search, call/email) and More.
More opens: Profile (view and edit phone/address), Leave balance (+ apply, cancel pending), Holiday calendar, Salary structure, Payslips (+ detail, share as text), Letters (+ detail, share), HR handbook, Select language, Settings (appearance: match phone / light / dark; language; sign out). See PAYROLL.md for how pay is calculated.
Language and appearance are stored on the phone only.

## Limitations

- **Never run on a device or emulator in the build environment.** Screens are type-checked and bundled, but layout, permission prompts, GPS behaviour, keyboard handling and navigation guards have not been exercised. Expect to fix visual and platform issues on first run.
- No screen/component tests (logic such as i18n completeness, money, calendar and handbook parsing is unit-tested).
- Hindi is a machine-assisted draft and covers the new screens and core tabs; punch result messages, location prompts and server error text are still English.
- Payslips and letters are shown and shared as text; there is no PDF export.
- No offline punch queue, by design: the server clock is authoritative, so a punch made offline and sent later would carry the wrong time. The app asks the user to retry when online.
- A response lost after the server rotates a refresh token can make the next refresh look like token reuse and end the session (user signs in again).
- No push notifications (Phase 6), biometric app lock, or app icons/splash (placeholders needed before store release). Bundle ids are `com.example.workforce`; change them before building.
- Request status is shown on refresh; there is no live push when a reviewer decides.
- The person's email is shown only after an interactive sign-in (`/auth/me` does not return it).

## API note (Phase 5)

Memberships returned by login and `/auth/me` now also include a sorted `permissions` array (used by the web menu). The mobile app ignores it; the API still enforces every permission.

## API note (Phase 6)

The API now has push-token endpoints (`POST /me/push-tokens`, `/me/push-tokens/remove`), leave endpoints and employee documents. **The mobile app does not use them yet**: it needs `expo-notifications` and a real device build to register tokens, and has no leave or document screens.
