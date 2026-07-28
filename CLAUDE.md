# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start development server (Vite)
npm run build    # Production build
npm run lint     # Run ESLint
npm run preview  # Preview production build
```

## Architecture

This is a React 19 + Vite 6 meetings/networking app for events, using **Firebase 11** as backend (Firestore, Auth, Storage, FCM) and **Mantine v7** for UI components. React Router v7 handles routing. No test framework is configured.

### Core Entities (Firestore Collections)

- **organizations/{orgId}**: Tenant grouping of events (name, owners: admin uids). Superadmins see all; regular admins only orgs where they're listed in `owners`.
- **events/{eventId}**: Event config (scheduling, formFields, registrationForm, policies, eventSurvey). Has its own `owners: uid[]` (independent of the parent org's owners) and an `organizationId` linking it to `organizations/{orgId}`.
- **events/{eventId}/companies/{nitNorm}**: Companies (razonSocial, logoUrl, fixedTable). Subcollection `visits/{attendeeUid}`: stand visits (see `StandVisit` in types.ts) — one doc per visitor, covered by the `companies/{companyId=**}` wildcard rule.
- **events/{eventId}/meetings**: Meeting requests (requesterId, receiverId, status, productId?, companyId?, contextNote?). `status` includes `standby` (accepted but blocked on check-in) and external/completed meetings (`isExternal`, `completed`).
- **events/{eventId}/products**: Products (ownerUserId, companyId, title, description, imageUrl)
- **events/{eventId}/agenda**: Slots with tableNumber, startTime, endTime, available, meetingId, date, isBreak
- **users**: Global collection, filtered by `eventId`. Attendees with companyId, tipoAsistente, raffleTickets, etc. Check-in is per-day: `checkIns` map keyed by event date (`YYYY-MM-DD`, or `"unico"` for single-day events without dates) — helpers in `src/utils/eventDays.ts`.
- **locks**: Prevents double-booking: lockId = `{eventId}_{userId}_{date}_{start}-{end}`
- **aiChats**: Chatbot conversation history (userId, eventId, message, intent, aiMessage, results)
- **admins/{uid}**, **adminRequests/{uid}**: Admin accounts and pending admin-signup approval requests (superadmin-gated)
- **notifications**, **meetingSurveys**, **eventSurveys** (event-wide satisfaction survey, distinct from per-meeting `meetingSurveys`), **config/generalSettings**

Firestore rules (`firestore.rules`) key pattern: most collections are world-readable; writes generally require `request.auth != null`; event/org mutation (not the meetings/agenda/products/companies subcollections attendees write to) requires `canManageEvent` — the caller must be listed in the event's `owners` or be a superadmin (`admins/{uid}.isSuperAdmin`). See [[firestore-rules-attendee-writes]] memory — over-tightening these rules previously broke attendee meeting flows.

### Event Policies (event.config.policies)

Configurable per event via admin panel (`EventPoliciesModal.tsx`). Interface + defaults live in `EventPolicies` / `DEFAULT_POLICIES` in `src/pages/dashboard/types.ts` — that file is the source of truth; the list below is a summary:
- `roleMode`: "open" | "buyer_seller" — who can meet whom
- `tableMode`: "pool" | "fixed" — table assignment (pool=auto, fixed=company-assigned)
- `discoveryMode`: "all" | "by_role" — directory visibility
- `schedulingMode`: "manual" | "requester_picks"
- `sellerRedirectToProducts`, `cardFieldsConfig`, `uiViewsEnabled` — as before
- `viewsOrder`: string[] — order of dashboard tabs (`chatbot`, `matches`, `attendees`, `companies`, `products`, `activity`, `survey`); enabled views missing from the array render last
- `whatsappApiVersion`: "v1" | "v2", `whatsappNotificationsEnabled`, `fallbackEmailOnWaFailure` — WhatsApp notification behavior
- `autoReassignOnCancel` — auto-reassign slot when a meeting is cancelled
- `surveyBlockedFor` / `surveyMode` — per-meeting survey gating (see `EventPolicies.surveyMode`/`surveyBlockedFor`, distinct from the event-wide `eventSurvey`)
- `meetingConfirmationEnabled` — forces post-meeting confirmation via `MeetingConfirmationGuard`
- `standbyCheckInRequired` — accepted meetings sit in `standby` until both participants check in
- `attendeeIdEnabled` — assigns a display ID on registration (e.g. `1C`, `2V`) via the `generateAttendeeId` Cloud Function
- `dashboardNotificationsEnabled`, `welcomeMessageEnabled` — in-app notifications / WhatsApp welcome popup
- `groupByRazonSocial` — group companies by name instead of NIT
- `allowProductImageUpload`, `maxMeetingsPerContact` — product/meeting limits
- `raffleEnabled`, `raffleShowPointsToAttendee` — enables the meeting-raffle feature (see below)
- `standVisitsEnabled`, `standVisitAllowSellerScan` — stand-visit registration via QR (see below)

Some newer per-event toggles (e.g. `cancelMeetingDisabled`, read in `CalendarTab.tsx`/`EventPoliciesModal.tsx`) are set directly on the policies object without yet being formalized in the `EventPolicies` interface — check `EventPoliciesModal.tsx` for the full current set of admin-configurable toggles rather than relying solely on the type.

### Key Directories

- `src/firebase/firebaseConfig.js` — Firebase init, exports `db`, `auth`, `storage`, `messaging`
- `src/context/UserContext.jsx` — Auth state (anonymous auth + manual login by cedula/email), exports `UserProvider` and `UserContext`
- `src/context/AdminAuthContext.tsx` — Separate admin auth layer (Firebase email/password). Exports `AdminAuthProvider`, `useAdminAuth`. Checks `admins/{uid}` collection to verify admin status and `isSuperAdmin` flag. Firebase auth persistence is shared across tabs, so a transient `null` from `onAuthStateChanged` with the `adminSession` localStorage flag set gets a 1.5s grace timer before clearing admin state — don't "simplify" this away or new tabs will kick existing admin tabs to login.
- `src/utils/companyStorage.ts` — Logo upload to Firebase Storage
- `src/utils/analytics.ts` — Centralized GA4 event tracking (typed `AnalyticsEvent` union, used via `TrackedButton` and direct `trackEvent()` calls)
- `src/utils/whatsappService.ts` — Client-side WhatsApp notification sender (supports v1/v2 API controlled by `whatsappApiVersion` policy)
- `src/utils/eventDays.ts` — Per-day check-in helpers (`getEventDayKeys`, `resolveCheckInDay`, `isCheckedInOnDay`); the check-in "day" key is an event date or `"unico"`
- `src/utils/qrScan.ts` — `parseAttendeeQrUrl`: parses a scanned badge QR. Current badges encode only the attendee uid as plain text; legacy link patterns (`/admin/event/:id/checkin/:uid`, `/badge/:id/:uid`) still parse for already-printed badges. When eventId comes back null, the caller must validate the attendee belongs to the event.
- `src/utils/attendeeFields.ts` — splits event formFields into basic/additional for scan-review cards
- `src/hooks/usePageTracking.ts` — GA4 page view tracking on route changes
- `src/hooks/useAttendeeScanFlow.ts` — shared "scan → review card → confirm → keep scanning" state machine used by admin check-in (`CheckInTab.jsx`) and seller stand-visit scanning (`MyCompanyTab.tsx`), built on `QrScannerModal.tsx` (camera scanner; stays open between reads with a 2s same-code debounce; imports html5-qrcode dynamically so the ~100 kB lib only loads when a scanner opens) + `AttendeeScanReviewModal.tsx`/`AttendeeInfoCard.tsx`
- `src/pages/admin/` — Admin panel: organizations, event management, attendees, meetings, policies config. `AdminLogin.tsx` / `AdminRegister.tsx` for admin auth. `AdminsManagementModal.tsx` for superadmin to approve/reject admin requests. `MatrixPage.jsx` and `EventAdmin.jsx` are the largest files (~3900 and ~2260 lines).
- `src/pages/dashboard/` — Attendee dashboard with discovery views + activity tabs. `AssistantsTab.tsx` for AI assistant view.
- `src/components/` — Shared components (UserProfile, DashboardHeader, TrackedButton, ProtectedAdminRoute, OptimisticCheckbox). Note: `components/NotificationMenu.jsx` is an empty, unreferenced file — the real one is `pages/dashboard/NotificationsMenu.tsx`.
- `src/pages/Dashboard_old.jsx` — legacy pre-rewrite dashboard, unused/dead code; the live dashboard is `src/pages/dashboard/Dashboard.tsx`.

### Dashboard Architecture

`Dashboard.tsx` → `useDashboardData.ts` (hook) → `TabsPanel.tsx` (view router)

**TabsPanel** uses a `SegmentedControl` with sections driven by `policies.uiViewsEnabled`:
1. **Chatbot** (`ChatbotTab.tsx`) — AI-powered search assistant (also gated by `VITE_ENABLE_CHATBOT` env var)
2. **Matches** (`MatchesTab.tsx`) — Affinity-based attendee recommendations
3. **Directorio** (`AttendeesView.tsx`) — Card-based attendee list with search/filters
4. **Empresas** (`CompaniesView.tsx`) — Companies grouped by NIT with logo, representatives, meeting CTA
5. **Productos** (`ProductsView.tsx`) — Product catalog with company/text filters, meeting CTA with context
6. **Mi actividad** — Tabs for: Agenda (`CalendarTab`), Reuniones (`MeetingsTab`), Solicitudes (`RequestsTab`), Mis productos (`MyProductsTab`), Mi empresa (`MyCompanyTab`)

Meeting requests from CompaniesView/ProductsView pass context (productId, companyId, contextNote). `EventSurveyTab.tsx` renders the event-wide satisfaction survey (`event.config.eventSurvey`) when enabled, separate from the per-meeting survey flow.

Conditional view behavior:
- With `standVisitsEnabled`, a **"Mi stand"** view (embeds `MyCompanyTab`) is prepended only for users with a company AND `tipoAsistente === "vendedor"` (buyers also register companies, so having a company is not enough), and becomes their landing view. `CompaniesView` cards show "Visitado" (from `myStandVisits` in `useDashboardData`) and "Reunión hh:mm" (derived from acceptedMeetings + participantsInfo) status badges.
- With `schedulingMode: "requester_picks"`, the "Solicitudes" sub-tab is hidden (instant confirmation means pending requests never exist).
- `DashboardHeader` always shows a badge-QR icon button (opens `/badge/:eventId/:uid`); with `standVisitsEnabled` it also shows an "Escanear stand" button that opens the in-app `QrScannerModal` and navigates to `/stand-visit/...` on a valid stand QR (`parseStandVisitQrUrl`) — this avoids the native-camera flow landing in a browser without the attendee's session.

### Key Hooks

- **`useDashboardData.ts`** — Centralizes ALL dashboard state and Firestore operations (real-time via onSnapshot). ~2100 lines; also owns standby/check-in promotion, meeting confirmation, and raffle-ticket logic.
- **`useCompanyData.ts`** — Used by `CompanyLanding` and `MyCompanyTab` for company data, products, representatives, and meeting requests. Also owns stand-visit logic: real-time `visits` subscription (opt-in via `subscribeToVisits` — only `MyCompanyTab` passes it; the visitor list is not public on `CompanyLanding`) and the seller-scan `lookupAttendeeForVisit`/`confirmVisit` pair.

### Organizations & Admin Hierarchy

Admins are grouped by **organizations** (a multi-tenant layer above events):
- `/admin` → `OrganizationsPanel.tsx` — lists orgs the admin owns (or all orgs for superadmins); create org, assign owners, or drill into one.
- `/admin/organization/:orgId` and `/admin/events` → `AdminPanel.jsx` — event list, filtered by `organizationId` when reached via an org (unfiltered/legacy view via "Ver Todos los Eventos" from `/admin/events`).
- An admin can manage an event either via org-level `owners` (on `organizations/{orgId}`) or by being listed directly in that event's own `owners` array — both are checked by `canManageEvent` in `firestore.rules`.

### Meeting Lifecycle Extras

Beyond the base request/accept/cancel flow (see `EventPoliciesModal.tsx`, `CalendarTab.tsx`, `MeetingsTab.tsx`, `EventAdmin.jsx` "Operación" tab):
- **Standby check-in** (`standbyCheckInRequired`): accepted meetings sit in `standby` status until both participants check in on the meeting's date (`checkIns[meetingDate]` — see per-day check-in above); un-checking in reverts them. Standby slots are usable as a scheduling fallback.
- **Meeting confirmation** (`meetingConfirmationEnabled`): `MeetingConfirmationGuard.tsx` blocks the UI and polls until a participant confirms a past meeting actually happened.
- **External meetings**: `ExternalMeetingModal.jsx` (attendee-admin driven) registers meetings that happened outside the system — no agenda slot consumed, stored with `isExternal: true, completed: true`.
- **Raffle** (`raffleEnabled`): sellers show a per-meeting QR (`RaffleQrModal.tsx`); buyers scan it via `/raffle-scan/:eventId/:meetingId` (`RaffleScanPage.tsx`) to award themselves a ticket (`users/{uid}.raffleTickets`, incremented, one claim per meeting). `raffleShowPointsToAttendee` controls whether buyers see their own count. Admin draws winners (ticket-weighted random) at `/admin/event/:eventId/raffle` (`RafflePage.tsx`).
- **Check-in / badges**: `CheckInTab.jsx` (inside `AttendeesList.jsx`) lists real-time check-in status with a day selector (writes `checkIns.{day}` on the user doc; un-checking uses `deleteField()`) and an "Escanear QR" badge-scanning flow via `useAttendeeScanFlow`. `BadgePage.tsx` (`/badge/:eventId/:userId`, also reachable from the dashboard header menu "Ver mi código QR") renders a printable badge whose QR encodes only the attendee uid — check-in happens from the admin scanner, not by navigating. `QuickCheckInPage.tsx` (`/admin/event/:eventId/checkin/:userId`) remains for legacy printed badges that encoded a link.
- **Stand visits** (`standVisitsEnabled`): two directions for registering that an attendee visited a company's stand, both writing `events/{eventId}/companies/{nitNorm}/visits/{attendeeUid}` (one visit per attendee per stand; requires the visitor to be checked in on the current day, and not visiting their own stand). (1) Attendee scans the stand's fixed QR (`StandVisitQrModal.tsx` in `MyCompanyTab`, encodes `/stand-visit/:eventId/:companyNit`) → `StandVisitScanPage.tsx` self-registers the visit. (2) With `standVisitAllowSellerScan`, the stand representative scans the visitor's badge from `MyCompanyTab` ("Escanear visitante") → `lookupAttendeeForVisit`/`confirmVisit` in `useCompanyData.ts`. `MyCompanyTab` shows the real-time visitor list.

### Data Flow

- `UserContext` provides `currentUser`, `updateUser()`, `loginByCedula()`, `loginByEmail()`, `logout()`
- `useDashboardData.ts` centralizes ALL dashboard state and Firestore operations (real-time via onSnapshot)
- Companies loaded as real-time subscription from `events/{eventId}/companies`
- Policies loaded from `event.config.policies` with DEFAULT_POLICIES fallback
- Meeting acceptance uses Firestore transactions + locks to prevent double-booking
- Fixed table mode filters available slots by company's assigned table

### Registration Flow (Landing.jsx)

- Configurable multi-step (stepper) or flat form driven by `event.config.registrationForm`
- Company step: NIT input → auto-lookup from companies subcollection → auto-fill razón social + logo preview
- Optional company logo upload to Firebase Storage (`companies/{eventId}/{nitNorm}/logo.{ext}`)
- On submit: creates/updates company doc + creates user + associates user↔company via companyId

### Admin Authentication

Admin routes are protected by `ProtectedAdminRoute`, which uses `useAdminAuth()` from `AdminAuthContext`. Admin users are stored in the `admins` Firestore collection with an `isSuperAdmin` boolean. New admin accounts require superadmin approval via `AdminsManagementModal.tsx` (pending → approved/rejected workflow).

### Routing (App.jsx)

All `/admin/...` routes (except `/admin/login` and `/admin/register`) are wrapped in `ProtectedAdminRoute`. Landing page loads eagerly; all other routes use `React.lazy`. `/matrix/:eventId` and `/badge/:eventId/:userId` are notably NOT admin-protected.

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | Landing | Default registration page |
| `/event/:eventId` | Landing | Event-specific registration |
| `/dashboard` | Dashboard | Attendee dashboard (no event filter) |
| `/dashboard/:eventId` | Dashboard | Event-specific dashboard |
| `/dashboard/:eventId/company/:companyNit` | CompanyLanding | Public company landing page |
| `/dashboard/:eventId/my-products` | MyProductsPage | User's products page |
| `/dashboard/:eventId/my-company` | MyCompanyPage | User's company page |
| `/admin/login` | AdminLogin | Admin login (unprotected) |
| `/admin/register` | AdminRegister | Admin registration request (unprotected) |
| `/admin` | OrganizationsPanel | List organizations (protected) |
| `/admin/organization/:orgId` | AdminPanel | Events within an organization (protected) |
| `/admin/events` | AdminPanel | All events, legacy/unfiltered view (protected) |
| `/admin/event/:eventId` | EventAdmin | Event management (protected) |
| `/admin/event/:eventId/agenda` | AgendaAdminPanel | Schedule management (protected) |
| `/admin/event/:eventId/match` | EventMatchPage | Event matching (protected) |
| `/admin/event/:eventId/import-meetings` | ImportMeetingsFromExcelPage | Bulk meeting import (protected) |
| `/admin/surveys` | MeetingSurveys | Per-meeting survey responses (protected) |
| `/admin/event/:eventId/event-survey` | EventSurveyResultsPage | Event-wide survey results (protected) |
| `/admin/event/:eventId/checkin` | CheckInPage | QR code attendee check-in (protected) |
| `/admin/event/:eventId/checkin/:userId` | QuickCheckInPage | One-tap check-in from a badge QR (protected) |
| `/admin/event/:eventId/raffle` | RafflePage | Raffle ticket list + weighted draw (protected) |
| `/admin/event/:eventId/optimize-agenda` | OptimizeAgendaPage | AI-powered agenda optimizer (protected) |
| `/matrix/:eventId` | MatrixPage | Matrix view (not admin-protected) |
| `/badge/:eventId/:userId` | BadgePage | Printable attendee badge with check-in QR (not admin-protected) |
| `/raffle-scan/:eventId/:meetingId` | RaffleScanPage | Buyer scans seller's QR to claim a raffle ticket |
| `/stand-visit/:eventId/:companyNit` | StandVisitScanPage | Attendee scans a stand's QR to register a visit |
| `/phonesadmin` | PhonesAdminPage | Phone management |
| `/meeting-response/:eventId/:meetingId/:action` | MeetingAutoResponse | Auto-response handler |

### Multi-Day Event Support

Events support multiple days via two Firestore fields on the event document:
- `eventDates`: string[] — list of ISO date strings for event days
- `dailyConfig`: `{ [date: string]: { startTime, endTime, breakBlocks: [{start, end}][] } }` — per-day schedule

`AgendaSlot` has a `date: string` field and `isBreak?: boolean`. The `EditEventConfigModal.jsx` reads `dailyConfig` or falls back to legacy `eventDate` (single-day). Attendee check-in is also per-day (`users.checkIns` map; day resolution in `src/utils/eventDays.ts`). Migration scripts in `scripts/` handle data migrations for existing events.

### Agenda Optimizer (`OptimizeAgendaPage.tsx`)

Calls a separate FastAPI service (`agenda-optimizer-api` repo) to auto-generate an optimal meeting schedule using affinity scores and OR-Tools. The service URL is `VITE_OPTIMIZER_API_URL` (default `http://127.0.0.1:8080` for local dev). The page loads attendees + affinity pairs from Firestore, sends them to the optimizer, and writes results back to `events/{eventId}/agenda`.

### Migration Scripts (`scripts/`)

Node.js scripts using Firebase Admin SDK. Require `scripts/serviceAccountKey.json` (not in repo — download from Firebase console). Run with `node scripts/<script>.js`:
- `migrate-agenda.js` — migrates legacy single-day agenda slots to multi-day format
- `migrate-multi-day-events.js` — backfills `dailyConfig` for existing multi-day events
- `cleanup-old-agenda.js` — removes deprecated agenda fields
- `seed-admin.js` — creates initial superadmin account

### Cloud Functions (`functions/index.js`, ~4300 lines)

- `notifyMeetingsScheduled`: `onSchedule`, every 5 minutes (America/Bogota timezone). **Currently hardcoded to a single `eventId`** — check before deploying to a new event. Requires secrets: `WHATSAPP_API_V1`, `WHATSAPP_API_V2`, `WHATSAPP_ACCOUNT_ID`.
- `aiProxy`: HTTP function for chatbot backend. Uses Google Gemini API for intent classification (greeting, search_query, general_question, meeting_related) and context-aware search across attendees, products, companies. Requires secrets: `GEMINI_API_KEY`, `GEMINI_API_URL`, `DEFAULT_AI_MODEL`.
- Affinity/matching pipeline: `calculateAffinityOnUserCreate` / `calculateAffinityOnUserUpdate` (Firestore triggers, recompute a user's affinity scores on write), `recalculateEventAffinity` and `generateOptimalMatches` (HTTP, bulk recompute / suggest matches for `MatchesTab.tsx` and `EventMatchPage.jsx`).
- Vector search (embeddings-based, backs `ChatbotTab`/`aiProxy` search): `vectorizeDocuments`, `regenerateVectorsForEvent`, `generateAllSearchVectors` build embeddings from `VECTOR_FIELDS`/`VECTOR_SEARCH_FIELDS`; `vectorSearch` queries them. See `functions/VECTOR_SEARCH_API.md`.
- Misc HTTP functions: `checkEmailAvailability` (registration duplicate-email check), `improveUserDescription` (AI-assisted profile text), `cancelAndReassign` (backs `autoReassignOnCancel` policy), `generateAttendeeId` (backs `attendeeIdEnabled` policy).
- Secrets are documented in `functions/SECRETS_CONFIG.md`; set via `firebase functions:secrets:set <NAME>`.
- Deploy: `firebase deploy --only functions` (Node 22)

### External API Integrations

- **WhatsApp API**: `apiwhatsapp.geniality.com.co` — meeting request/acceptance notifications
- **SMS API**: Onurix — meeting reminders from Cloud Functions

### UI Stack

- Mantine v7 (core, dates, modals, notifications, tiptap)
- @dnd-kit for drag-and-drop (admin field config)
- qrcode for QR generation (badges, raffle, stand QRs); html5-qrcode for camera scanning (`QrScannerModal`)
- dayjs for date handling
- xlsx for Excel import/export
- @tabler/icons-react for icons
- Tiptap for rich text editing

## Environment Variables

Firebase config via Vite env vars (prefix `VITE_`):
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_VAPID_KEY` — VAPID key for FCM push notification subscriptions
- `VITE_ENABLE_CHATBOT` — toggles chatbot tab availability (separate from policy toggle)
- `VITE_AI_PROXY_URL` — deployed URL of the `aiProxy` Cloud Function (chatbot backend)
- `VITE_OPTIMIZER_API_URL` — agenda optimizer FastAPI service URL (local: `http://127.0.0.1:8080`)

## npm Configuration

`.npmrc` has `legacy-peer-deps=true` to handle peer dependency conflicts.

## Code Conventions

- Mixed JSX (JavaScript) and TSX (TypeScript) — new files should be .tsx
- Spanish used in variable names, comments, and UI text
- ESLint flat config (`eslint.config.js`) only targets `**/*.{js,jsx}` — TypeScript files are not linted
- Types defined centrally in `src/pages/dashboard/types.ts`
- Custom Mantine theme with Barlow font family (`src/index.jsx`)
- Provider order: `UserProvider` > `BrowserRouter` > `AdminAuthProvider` > `MantineProvider` > `ModalsProvider` > `Notifications` > `App`
- StrictMode is disabled

## Extending the System

- **New dashboard view**: Add to `uiViewsEnabled` in types.ts, create `XxxView.tsx`, add to `TabsPanel.tsx` SegmentedControl
- **New role mode**: Add value to `roleMode` in EventPolicies, update filtering in useDashboardData effect #5
- **New event policy**: Add to EventPolicies interface + DEFAULT_POLICIES, add UI in EventPoliciesModal
