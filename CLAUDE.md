# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start development server (Vite)
npm run build    # Production build
npm run lint     # Run ESLint
npm run preview  # Preview production build
npm --prefix functions run lint   # Lint Cloud Functions — runs as firebase predeploy and blocks `firebase deploy` on errors
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
- **events/{eventId}/waMessages/{wamid}**: Log of every WhatsApp sent via the official API (v2): type (`meeting_request`, `meeting_confirmation`, `meeting_cancelled`, `meeting_rejected`, `welcome`, `advisor_notice`, `pending_reminder`, `meeting_reminder`, `campaign`), recipient `userId`, `meetingId`, `status` (`error` → never sent; `sent` → `delivered` → `read`, or `failed`). Client sends log via the `tracking` option of the `whatsappService.ts` functions (`src/utils/waTracking.ts`); Cloud Functions via `functions/waTracking.js`. Delivery statuses arrive from Meta through wa-multi-session-backend → `guardarRespuestaWhatsapp` (`type: "status"`, matched by a `messageId` collection-group query — needs the fieldOverride in `firestore.indexes.json`). Read only by event managers; shown at `/admin/event/:eventId/whatsapp` (`WaTrackingPage.tsx`). That page's "Analítica Meta por día" tab (`WaMetaAnalyticsTab.tsx`) reads Meta's own analytics (usable for events before the tracking existed; account/number-wide, not per event or recipient): `getWaMessageAnalytics` → backend `/api/message-analytics` (sent/delivered of the main number every half hour, last 365 days, no activation needed — shown by Bogotá day/hour) and `getWaTemplateAnalytics` → `/api/template-analytics` (daily per template, last 90 days only, and only if Template Insights is enabled on the WABA — it currently is not, Meta subcode 4182004).
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
- `discoveryMode`: "all" | "by_role" | "sellers_see_all" — directory visibility (`sellers_see_all`: sellers see everyone, buyers see only sellers). Rules live in `canDiscoverAttendee` (`src/utils/attendeeRole.ts`)
- `schedulingMode`: "manual" | "requester_picks"
- `sellerRedirectToProducts`, `cardFieldsConfig`, `uiViewsEnabled` — as before
- `forceBuyerRoleOnRegistration` (only relevant when `roleMode: "buyer_seller"`) — public registration form (`Landing.jsx`) hides the "Tipo de asistente" selector and forces every registration to `tipoAsistente: "comprador"`; sellers must be assigned manually afterward (e.g. `ModalEditAttendee.jsx`) since they no longer self-select "vendedor" at signup
- `forceSellerRoleOnRegistration` — mirror of the above forcing `tipoAsistente: "vendedor"` (buyers assigned manually). Mutually exclusive with the buyer toggle (the modal switches enforce it; if both are ever set, buyer wins). Landing resolves the forced role via `getForcedRegistrationRole` in `src/utils/attendeeRole.ts`
- `roleUrlParamEnabled`, `roleUrlParamName` (default `"rol"`), `roleUrlParamValues: { comprador, vendedor }` — force the registration role from a URL query param (e.g. `/event/:id?rol=vendedor`); a valid param value takes precedence over the two global force toggles
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
- `maxMeetingsPerRole`: `{ comprador?, vendedor? }` — max meetings a requester of each role may *request* (only meaningful with `roleMode: "buyer_seller"`; receivers are never limited); `maxMeetingsPerRoleScope`: "total" | "day" controls whether the count is event-wide or resets per event day
- `raffleEnabled`, `raffleShowPointsToAttendee` — enables the meeting-raffle feature (see below)
- `standVisitsEnabled`, `standVisitAllowSellerScan` — stand-visit registration via QR (see below)
- `pendingRemindersEnabled` (+ `pendingRemindersEveryHours`, `MinAgeHours`, `StartHour`/`EndHour` Bogotá window, `Whatsapp` + `Template {name, language}`, `Email`) — periodic digest to whoever has `pending` requests to answer (direct `receiverId`, or every user of the target `companyId` for company requests). Cloud Functions in `functions/pendingReminders.js`: `sendPendingRequestReminders` (every 30 min) and `runPendingReminders` (admin HTTP, dry-run/send-now, backs `PendingRemindersSettings.tsx`). WhatsApp goes through `/api/campaign/send` with a Meta template whose body vars are, in order, nombre/evento/pendientes/empresa; email goes directly to `apigencampus /email/custom`. Per-recipient state lives in `events/{eventId}/pendingReminders/{uid}`; it stops after the last event day
- `advisorNoticeTemplate`: `{name, language}` — Meta template (v2) for informational notices to a requester's/receiver's company colleagues (request/accept/reject/cancel of a colleague's meeting); without it, v2 notices are in-app only
- `qrOnlyModeEnabled` — attendee dashboard shows only their attendance QR (no tabs); for events using the app purely for access control/check-in
- `companyLoginEnabled` — alternative login on the Landing "Ingresar" tab for attendees who don't know which email they were registered with (a colleague registered them): search the company by NIT or name (`events/{eventId}/companies`, grouped by name with `groupByRazonSocial`) → pick their name → type the full registered phone, of which only the last 4 digits are shown. `CompanyLoginFlow.tsx` + `src/utils/companyLogin.ts` → Cloud Functions in `functions/companyLogin.js`: `companyLoginCandidates` (returns only masked phones; users matched by `companyId`, so attendees registered without NIT can't use it) and `companyLoginVerify` (compares `telefono`/`contacto.telefono` digits, with or without country code; 5 failures lock that attendee 15 min via `events/{eventId}/loginAttempts/{uid}`, read only by event managers). On success the client reads the user doc and calls `loginAsUser`. Only as strong as the rest of the attendee login: `users` stays world-readable
- `calendarInvitesEnabled` (+ `calendarInvitesLocation`, venue text shown next to the table) — when a meeting becomes `accepted`, emails each participant an iCalendar invite (.ics) to add it to their calendar. Sent once per meeting: later changes (time, table, cancellation) are not re-sent. Cloud Function `onMeetingCalendarInvite` (`functions/calendarInvites.js`, Firestore trigger on `events/{eventId}/meetings/{meetingId}`) → wa-multi-session-backend `POST /api/email/meeting-invite` (`x-api-key` = `WA_CAMPAIGN_API_KEY`; the backend builds the .ics + email and sends it itself, not through apigencampus). Marks the meeting `calendarInvite: { sent: true, recipients, sentAt, lastResults }`, claimed in a transaction so the trigger's own write is a no-op. Meetings accepted before enabling it, external meetings and meetings that already started get no invite
- `calendarFeedEnabled` — shows a "Sincronizar con mi calendario" button in the Agenda (`CalendarSyncButton.tsx`) that subscribes the attendee's Google Calendar / Outlook / Apple calendar to a personal iCalendar feed: HTTP Cloud Function `calendarFeed` (`functions/calendarFeed.js`, `GET ?e=<eventId>&u=<uid>&t=<token>`) returning their `accepted`, non-external meetings, so new meetings, time/table changes and cancellations sync without re-sending anything — at each calendar's own refresh rate (Google 12–24 h, can't be forced). `t` must match `users/{uid}.calendarFeedToken` (random, generated client-side on first open; "Generar un link nuevo" rotates it). With the policy off the feed returns an empty calendar. Event UIDs match the email invite's, but a subscribed calendar is a separate calendar, so attendees who also added the email invite see the meeting twice
- `companySurveyEnabled` (+ `companySurvey: { targetRole: "all"|"vendedor"|"comprador", title, intro, meetingsQuestion, valueQuestion, outro }`) — post-event results survey, **one answer per company**: `CompanySurveyGuard.tsx` (mounted in `Dashboard.tsx`) shows a non-closable modal asking meetings held + projected business value (USD) until anyone of the attendee's company answers. Stored in `events/{eventId}/companySurveys/{companyKey}` (`companyKey` = `companyId`, or `u_<uid>` without company) with `reuniones`, `valorUSD`, `channel` (`web` | `whatsapp`), company and respondent; first answer wins (transaction + rule allows only `create` for attendees; `get` public, `list`/`update`/`delete` admin-only, and the catch-all read excludes it). WhatsApp channel, two ways: (1) **chat reply** — send the Meta template named in `companySurvey.waTemplate` as a WA campaign; whoever received it within 14 days can answer by typing the two numbers ("5 20000", also "5, 20.000 USD", "20 mil", "1.5M"; exactly two numbers required). wa-multi-session-backend offers every inbound text with digits to `guardarRespuestaWhatsapp` (`type: "text"`) before GenCampus; `functions/companySurveyWa.js` finds the campaign via a `waMessages` collection-group query on `to` (needs the fieldOverride in `firestore.indexes.json`), parses, saves with `channel: "whatsapp"` (+ `rawText`, `phone`, `campaignId`) and returns `{ handled, reply }` — the backend sends the confirmation/help text; (2) public page `/encuesta-empresa/:eventId/:userId` (`CompanySurveyPage.tsx`, no login), linked via the `$link.encuestaEmpresa` campaign variable. Listener is real-time, so a colleague's answer (either channel) unblocks the modal immediately; read errors fail open. Shared logic in `src/utils/companySurvey.ts`; answers show up (when enabled) as two extra columns — reuniones and negocios proyectados, with channel/respondent — in the admin Empresas table (`AttendeesList.jsx`) and its Excel export

Some newer per-event toggles (e.g. `cancelMeetingDisabled`, read in `CalendarTab.tsx`/`EventPoliciesModal.tsx`) are set directly on the policies object without yet being formalized in the `EventPolicies` interface — check `EventPoliciesModal.tsx` for the full current set of admin-configurable toggles rather than relying solely on the type.

Form fields (`event.config.formFields[]`) may carry `labelByRole: { comprador?, vendedor? }` (edited in `ConfigureFieldsModal.tsx`); resolve display labels with `getFieldLabel`/`withRoleLabel` from `src/utils/attendeeFields.ts` instead of reading `field.label` directly.

### Key Directories

- `src/firebase/firebaseConfig.js` — Firebase init, exports `db`, `auth`, `storage`, `messaging`
- `src/context/UserContext.jsx` — Auth state (anonymous auth + manual login by cedula/email), exports `UserProvider` and `UserContext`
- `src/context/AdminAuthContext.tsx` — Separate admin auth layer (Firebase email/password). Exports `AdminAuthProvider`, `useAdminAuth`. Checks `admins/{uid}` collection to verify admin status and `isSuperAdmin` flag. Firebase auth persistence is shared across tabs, so a transient `null` from `onAuthStateChanged` with the `adminSession` localStorage flag set gets a 1.5s grace timer before clearing admin state — don't "simplify" this away or new tabs will kick existing admin tabs to login.
- `src/utils/companyStorage.ts` — Logo upload to Firebase Storage
- `src/utils/analytics.ts` — Centralized GA4 event tracking (typed `AnalyticsEvent` union, used via `TrackedButton` and direct `trackEvent()` calls)
- `src/utils/whatsappService.ts` — Client-side WhatsApp notification sender (supports v1/v2 API controlled by `whatsappApiVersion` policy)
- `src/utils/eventDays.ts` — Per-day check-in helpers (`getEventDayKeys`, `resolveCheckInDay`, `isCheckedInOnDay`); the check-in "day" key is an event date or `"unico"`. Use `localTodayISO()` for "today" — `new Date().toISOString().slice(0, 10)` is UTC and already returns tomorrow after 7 p.m. in Colombia
- `src/utils/qrScan.ts` — `parseAttendeeQrUrl`: parses a scanned badge QR. Current badges encode only the attendee uid as plain text; legacy link patterns (`/admin/event/:id/checkin/:uid`, `/badge/:id/:uid`) still parse for already-printed badges. When eventId comes back null, the caller must validate the attendee belongs to the event.
- `src/utils/attendeeFields.ts` — splits event formFields into basic/additional for scan-review cards
- `src/utils/attendeeRole.ts` — `normalizeTipoAsistente`/`isVendedor`/`isComprador`: the `tipoAsistente` field ("comprador"/"vendedor") has been written with inconsistent casing across registration/admin-edit/legacy flows, so role checks should go through these helpers rather than comparing the raw string
- `src/hooks/usePageTracking.ts` — GA4 page view tracking on route changes
- `src/hooks/useVersionCheck.ts` — mounted in `App.jsx`; compares the loaded `/assets/index-<hash>.js` with the one referenced by the deployed `index.html` (Netlify, `max-age=0`) and auto-reloads stale tabs once the user isn't typing / in a modal
- `src/hooks/useAttendeeScanFlow.ts` — shared "scan → review card → confirm → keep scanning" state machine used by admin check-in (`CheckInTab.jsx`) and seller stand-visit scanning (`MyCompanyTab.tsx`), built on `QrScannerModal.tsx` (camera scanner; stays open between reads with a 2s same-code debounce; imports html5-qrcode dynamically so the ~100 kB lib only loads when a scanner opens) + `AttendeeScanReviewModal.tsx`/`AttendeeInfoCard.tsx`
- `src/pages/admin/` — Admin panel: organizations, event management, attendees, meetings, policies config. `AdminLogin.tsx` / `AdminRegister.tsx` for admin auth. `AdminsManagementModal.tsx` for superadmin to approve/reject admin requests. `MatrixPage.jsx` and `EventAdmin.jsx` are the largest files (~3900 and ~2400 lines).
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
6. **Mis reuniones** (`activity`) — Tabs for: Agenda (`CalendarTab`), Solicitudes (`RequestsTab`), Mis productos (`MyProductsTab`), Mi empresa (`MyCompanyTab`). The "Reuniones" sub-tab (`MeetingsTab`) is hidden — Agenda shows the same meetings/actions, and deep links/notifications asking for `reuniones` are redirected to `agenda`.

Meeting requests from CompaniesView/ProductsView pass context (productId, companyId, contextNote). `EventSurveyTab.tsx` renders the event-wide satisfaction survey (`event.config.eventSurvey`) when enabled, separate from the per-meeting survey flow.

Conditional view behavior:
- With `standVisitsEnabled`, a **"Mi stand"** view (embeds `MyCompanyTab`) is prepended only for users with a company AND `tipoAsistente === "vendedor"` (buyers also register companies, so having a company is not enough), and becomes their landing view. `CompaniesView` cards show "Visitado" (from `myStandVisits` in `useDashboardData`) and "Reunión hh:mm" (derived from acceptedMeetings + participantsInfo) status badges.
- With `schedulingMode: "requester_picks"`, the "Solicitudes" sub-tab is hidden (instant confirmation means pending requests never exist).
- `DashboardHeader` always shows a badge-QR icon button (opens `/badge/:eventId/:uid`); with `standVisitsEnabled` it also shows an "Escanear stand" button that opens the in-app `QrScannerModal` and navigates to `/stand-visit/...` on a valid stand QR (`parseStandVisitQrUrl`) — this avoids the native-camera flow landing in a browser without the attendee's session.

### Key Hooks

- **`useDashboardData.ts`** — Centralizes ALL dashboard state and Firestore operations (real-time via onSnapshot). ~2500 lines; also owns standby/check-in promotion, meeting confirmation, and raffle-ticket logic.
- **`meetingSlotEngine.ts`** (not a hook, but shared by both hooks above plus `MatrixPage`, `AttendeesList`, `CalendarTab`, etc.) — the single implementation of slot availability (`computeAvailableSlots`), confirmed-meeting creation with locks (`createConfirmedMeeting`), request creation (`createMeetingRequestDoc`), meeting limits, product CRUD, and WhatsApp/SMS notifications. Put new meeting-flow logic here rather than duplicating it in a hook.

### Company-Targeted Meeting Requests

A request can target a person (`receiverId`) or a whole company (`companyId`, no specific receiver). Company "advisors" are all users of the event with that `companyId` (`getCompanyAdvisors`, filtered by `canDiscoverAttendee` for the requester — so role, not just company, matters). All requests go through `assertMeetingRequestAllowed`: no requests to yourself or your own company, and at most one `pending` request per requester per company (to the company or any of its reps; `buildPendingCompanyKeys` is the UI mirror). Blocked requests throw `MeetingRequestBlockedError` (already notified — don't show a second generic error). With `requester_picks`, `pickAvailableCompanyAdvisor` picks the least-loaded advisor with a free slot. WhatsApp accept links for company requests use `/meeting-response/:eventId/:meetingId/:action/:advisorId`, so the advisor who taps is logged in and claims the meeting.
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

### WhatsApp Campaigns (EventAdmin → "Campañas WhatsApp")

Bulk send of Meta-approved templates to an event's attendees (templates are created/edited in Meta's template manager, not here). Code: `src/utils/waCampaigns.ts` (template analysis, variable mapping, per-recipient Meta `components` builder, Firestore actions), `src/pages/admin/waCampaigns/` (tab, 4-step wizard, detail modal), `functions/waCampaigns.js`.
- Client writes `events/{eventId}/waCampaigns/{id}` + `recipients/{userId}` (components pre-built per recipient) then sets `status: "queued"`. Firestore rules make `waCampaigns` readable only by `canManageEvent` (it holds phone numbers).
- `processWaCampaign` (onDocumentWritten, fires on transition to `queued`) claims the campaign (`running`), sends `pending` recipients via wa-multi-session-backend `POST /api/campaign/send` (header `x-api-key`), works ~8 min per invocation and re-queues itself until done. Admin can pause (`paused`) / resume / retry failed. A `running` campaign with `heartbeatAt` older than 10 min is shown as stalled and can be resumed.
- `listWaTemplates` (HTTP, requires admin Firebase ID token + canManageEvent) proxies the backend's `GET /api/templates`.
- Wizard "Variables" step: image headers default to the event image (`getEventImageUrl`), and "Enviar prueba" sends the built message to one number via `sendWaTemplateTest` (HTTP, canManageEvent → backend `/api/campaign/send`; no campaign/recipient docs are created); optionally to a registered attendee (`userId`): the message uses their real data and the send is logged in `waMessages` as `type: "campaign"` with `test: true` + `templateName` and no `campaignId`, so chat replies follow the real flow — e.g. a company-survey answer is saved with `test: true`). URL-button variables accept the full link: the template's fixed URL prefix is stripped automatically.
- Quick-reply buttons carry payload `{t:"wac",e,c,u,b}`; the backend forwards taps to `guardarRespuestaWhatsapp` (alias `guardarRespuestaEncuesta`, header `x-webhook-secret`), which stores `recipient.response`, campaign `responseCounts`, and optionally `users/{uid}[campaign.responseField]` (e.g. `encuestaValorNegocio`, shown automatically as a column in AttendeesList). It also still handles the legacy "valor de negocio" survey payload (lookup by phone).
- Secrets: `WHATSAPP_API_V2` (backend base URL), `WA_CAMPAIGN_API_KEY` (= backend `CAMPAIGN_API_KEY`). Each send is also logged to `waMessages` (type `campaign`), so delivered/read statuses are tracked there (see `waMessages` above).
- Phone numbers for WhatsApp: `toWhatsAppNumber` in `src/utils/phoneUtils.ts`.
- Recipients can also come from an uploaded Excel/CSV (`source: "import"`, `parseContactsFile`): contacts are NOT created as event users; recipient doc id is `ext_<whatsapp>`, the original row is kept in `recipient.data`, template variables map to file columns (`$col:<header>`), and `responseField` is unavailable (no user doc to write to).
- Template components are stored via `toStoredComponents` — Meta's `example` contains nested arrays, which Firestore rejects.

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
| `/admin/event/:eventId/whatsapp` | WaTrackingPage | WhatsApp (official API) tracking: sent/received/read by type, meeting-request conversion, who receives requests and doesn't accept (protected) |
| `/admin/event/:eventId/optimize-agenda` | OptimizeAgendaPage | AI-powered agenda optimizer (protected) |
| `/matrix/:eventId` | MatrixPage | Matrix view (not admin-protected) |
| `/badge/:eventId/:userId` | BadgePage | Printable attendee badge with check-in QR (not admin-protected) |
| `/raffle-scan/:eventId/:meetingId` | RaffleScanPage | Buyer scans seller's QR to claim a raffle ticket |
| `/stand-visit/:eventId/:companyNit` | StandVisitScanPage | Attendee scans a stand's QR to register a visit |
| `/acceso/:eventId/:userId` | AutoLoginPage | Direct-access link: logs the attendee in (`loginAsUser`, after checking `users/{userId}.eventId`) and redirects to the dashboard. Built with `buildAccessLink` (`src/utils/accessLink.ts`); copyable per attendee in AttendeesList ("Copiar acceso") and available in WA campaigns as `$link.acceso` |
| `/encuesta-empresa/:eventId/:userId` | CompanySurveyPage | Company results survey from a WhatsApp link (channel `whatsapp`, no login) |
| `/phonesadmin` | PhonesAdminPage | Phone management |
| `/meeting-response/:eventId/:meetingId/:action/:advisorId?` | MeetingAutoResponse | Accept/reject from a WhatsApp link (`advisorId` for company-targeted requests) |

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

`_`-prefixed scripts are one-off data maintenance for specific events (merges, cleanups, agenda changes). Newer ones follow a dry-run-by-default pattern (`--apply` to write) and write `*-backup-*.json` (gitignored — contains attendee data) before destructive changes; e.g. `_add-tables.js` (adds tables + updates `config.numTables`, which the admin "Añadir mesa" button doesn't), `_block-agenda-range.js` (block/unblock free slots in a time range), `_merge-companies.js` (merge duplicate company NITs). Never use the admin "Generar agenda" button on an event that already has an agenda — it re-creates every slot without checking existing ones.

### Cloud Functions (`functions/`, ESM)

`functions/index.js` (~4450 lines) holds the original functions and re-exports the newer modules `waCampaigns.js`, `pendingReminders.js`, `meetingReminders.js`, `calendarInvites.js`, `calendarFeed.js`, `companyLogin.js` (plus the shared `waTracking.js` logger) — put new functions in their own module and re-export them from `index.js`.

- `sendMeetingReminders` (`functions/meetingReminders.js`): every 5 min, for the event id(s) in secret `MEETING_REMINDER_EVENT_ID` (comma-separated), notifies both participants of each `accepted` meeting starting within `MEETING_REMINDER_MINUTES` (param, default 15) by WhatsApp (Meta template `MEETING_REMINDER_TEMPLATE`/`_LANG` params, default `notificacion_reunion_networking`/`es`, via `/api/campaign/send`; body vars nombre/evento/fecha/hora/contraparte/empresaContraparte/mesa/link, where link is the `/acceso/:eventId/:uid` auto-login URL — the URL button gets the same link minus the button's fixed prefix) and email. Claims the meeting in a transaction setting `reminderNotified: true` + `reminderNotifiedFor: "<date> <timeSlot>"` (a rescheduled meeting is notified again) and stores `reminderResults`. Secrets: `WHATSAPP_API_V2`, `WA_CAMPAIGN_API_KEY`, `MEETING_REMINDER_EVENT_ID`.
- `aiProxy`: HTTP function for chatbot backend. Uses Google Gemini API for intent classification (greeting, search_query, general_question, meeting_related) and context-aware search across attendees, products, companies. Requires secrets: `GEMINI_API_KEY`, `GEMINI_API_URL`, `DEFAULT_AI_MODEL`.
- Affinity/matching pipeline: `calculateAffinityOnUserCreate` / `calculateAffinityOnUserUpdate` (Firestore triggers, recompute a user's affinity scores on write), `recalculateEventAffinity` and `generateOptimalMatches` (HTTP, bulk recompute / suggest matches for `MatchesTab.tsx` and `EventMatchPage.jsx`).
- Vector search (embeddings-based, backs `ChatbotTab`/`aiProxy` search): `vectorizeDocuments`, `regenerateVectorsForEvent`, `generateAllSearchVectors` build embeddings from `VECTOR_FIELDS`/`VECTOR_SEARCH_FIELDS`; `vectorSearch` queries them. See `functions/VECTOR_SEARCH_API.md`.
- Misc HTTP functions: `checkEmailAvailability` (registration duplicate-email check), `improveUserDescription` (AI-assisted profile text), `cancelAndReassign` (backs `autoReassignOnCancel` policy), `generateAttendeeId` (backs `attendeeIdEnabled` policy).
- Secrets are documented in `functions/SECRETS_CONFIG.md`; set via `firebase functions:secrets:set <NAME>`.
- Deploy: `firebase deploy --only functions` (Node 22)

### External API Integrations

- **WhatsApp API**: `apiwhatsapp.geniality.com.co` (wa-multi-session-backend) — meeting notifications (v1 = unofficial session, v2 = official Meta API with templates), campaigns, template/analytics proxies
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
- `VITE_WHATSAPP_API_V1`, `VITE_WHATSAPP_API_V2`, `VITE_WHATSAPP_ACCOUNT_ID` — client-side WhatsApp endpoints/account (default to `apiwhatsapp.geniality.com.co` / `geniality`)
- `VITE_PUBLIC_APP_URL` — public app origin used for links inside WhatsApp campaign messages (e.g. `https://gen-meetings.netlify.app`); falls back to `window.location.origin`
- `VITE_WA_TEMPLATES_URL` — optional override for the `listWaTemplates` Cloud Function URL
- `VITE_PENDING_REMINDERS_URL` — optional override for the `runPendingReminders` Cloud Function URL (defaults to `https://us-central1-<projectId>.cloudfunctions.net/runPendingReminders`)
- `VITE_CALENDAR_FEED_URL` — optional override for the `calendarFeed` Cloud Function URL (same default pattern)
- `VITE_COMPANY_LOGIN_CANDIDATES_URL`, `VITE_COMPANY_LOGIN_VERIFY_URL` — optional overrides for the `companyLoginCandidates` / `companyLoginVerify` Cloud Function URLs (same default pattern)

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
