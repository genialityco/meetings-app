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

- **events/{eventId}**: Event config (scheduling, formFields, registrationForm, policies)
- **events/{eventId}/companies/{nitNorm}**: Companies (razonSocial, logoUrl, fixedTable)
- **events/{eventId}/meetings**: Meeting requests (requesterId, receiverId, status, productId?, companyId?, contextNote?)
- **events/{eventId}/products**: Products (ownerUserId, companyId, title, description, imageUrl)
- **events/{eventId}/agenda**: Slots with tableNumber, startTime, endTime, available, meetingId
- **users**: Global collection, filtered by `eventId`. Attendees with companyId, tipoAsistente, etc.
- **locks**: Prevents double-booking: lockId = `{eventId}_{userId}_{date}_{start}-{end}`
- **aiChats**: Chatbot conversation history (userId, eventId, message, intent, aiMessage, results)
- **notifications**, **meetingSurveys**, **config/generalSettings**

### Event Policies (event.config.policies)

Configurable per event via admin panel (`EventPoliciesModal.tsx`):
- `roleMode`: "open" | "buyer_seller" — who can meet whom
- `tableMode`: "pool" | "fixed" — table assignment (pool=auto, fixed=company-assigned)
- `discoveryMode`: "all" | "by_role" — directory visibility
- `schedulingMode`: "manual" | "auto"
- `sellerRedirectToProducts`: boolean — redirects sellers to "Mis productos" on first login, hides that tab for buyers
- `cardFieldsConfig`: { attendeeCard: string[], companyCard: string[] } — fields visible on dashboard cards per view
- `uiViewsEnabled`: { chatbot, matches, attendees, companies, products } — which dashboard views are shown
- `whatsappApiVersion`: "v1" | "v2" — WhatsApp notification API version
- `autoReassignOnCancel`: boolean — auto-reassign slot when a meeting is cancelled
- `surveyBlockedFor`: "none" | "compradores" | "vendedores" | "ambos" — lock survey for certain roles
- `surveyMode`: "default" | "custom" — "custom" uses per-role surveyConfig

Defaults defined in `DEFAULT_POLICIES` in `src/pages/dashboard/types.ts`.

### Key Directories

- `src/firebase/firebaseConfig.js` — Firebase init, exports `db`, `auth`, `storage`, `messaging`
- `src/context/UserContext.jsx` — Auth state (anonymous auth + manual login by cedula/email), exports `UserProvider` and `UserContext`
- `src/context/AdminAuthContext.tsx` — Separate admin auth layer (Firebase email/password). Exports `AdminAuthProvider`, `useAdminAuth`. Checks `admins/{uid}` collection to verify admin status and `isSuperAdmin` flag.
- `src/utils/companyStorage.ts` — Logo upload to Firebase Storage
- `src/utils/analytics.ts` — Centralized GA4 event tracking (typed `AnalyticsEvent` union, used via `TrackedButton` and direct `trackEvent()` calls)
- `src/utils/whatsappService.ts` — Client-side WhatsApp notification sender (supports v1/v2 API controlled by `whatsappApiVersion` policy)
- `src/hooks/usePageTracking.ts` — GA4 page view tracking on route changes
- `src/pages/admin/` — Admin panel: event management, attendees, meetings, policies config. `AdminLogin.tsx` / `AdminRegister.tsx` for admin auth. `AdminsManagementModal.tsx` for superadmin to approve/reject admin requests.
- `src/pages/dashboard/` — Attendee dashboard with discovery views + activity tabs. `AssistantsTab.tsx` for AI assistant view.
- `src/components/` — Shared components (UserProfile, DashboardHeader, NotificationMenu, TrackedButton, ProtectedAdminRoute)

### Dashboard Architecture

`Dashboard.tsx` → `useDashboardData.ts` (hook) → `TabsPanel.tsx` (view router)

**TabsPanel** uses a `SegmentedControl` with sections driven by `policies.uiViewsEnabled`:
1. **Chatbot** (`ChatbotTab.tsx`) — AI-powered search assistant (also gated by `VITE_ENABLE_CHATBOT` env var)
2. **Matches** (`MatchesTab.tsx`) — Affinity-based attendee recommendations
3. **Directorio** (`AttendeesView.tsx`) — Card-based attendee list with search/filters
4. **Empresas** (`CompaniesView.tsx`) — Companies grouped by NIT with logo, representatives, meeting CTA
5. **Productos** (`ProductsView.tsx`) — Product catalog with company/text filters, meeting CTA with context
6. **Mi actividad** — Tabs for: Agenda (`CalendarTab`), Reuniones (`MeetingsTab`), Solicitudes (`RequestsTab`), Mis productos (`MyProductsTab`), Mi empresa (`MyCompanyTab`)

Meeting requests from CompaniesView/ProductsView pass context (productId, companyId, contextNote).

### Key Hooks

- **`useDashboardData.ts`** — Centralizes ALL dashboard state and Firestore operations (real-time via onSnapshot). ~1600 lines.
- **`useCompanyData.ts`** — Used by `CompanyLanding` and `MyCompanyTab` for company data, products, representatives, and meeting requests.

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

All admin routes (except `/admin/login` and `/admin/register`) are wrapped in `ProtectedAdminRoute`. Landing page loads eagerly; all other routes use `React.lazy`.

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
| `/admin` | AdminPanel | List all events (protected) |
| `/admin/event/:eventId` | EventAdmin | Event management (protected) |
| `/admin/event/:eventId/agenda` | AgendaAdminPanel | Schedule management (protected) |
| `/admin/event/:eventId/match` | EventMatchPage | Event matching (protected) |
| `/admin/event/:eventId/import-meetings` | ImportMeetingsFromExcelPage | Bulk meeting import (protected) |
| `/admin/surveys` | MeetingSurveys | Survey responses (protected) |
| `/matrix/:eventId` | MatrixPage | Matrix view |
| `/phonesadmin` | PhonesAdminPage | Phone management |
| `/meeting-response/:eventId/:meetingId/:action` | MeetingAutoResponse | Auto-response handler |

### Cloud Functions (`functions/`)

- `notifyMeetingsScheduled`: Runs every 5 minutes (America/Bogota timezone). **Currently hardcoded to a single `eventId`** — check `functions/index.js` before deploying to a new event. Requires secrets: `WHATSAPP_API_V1`, `WHATSAPP_API_V2`, `WHATSAPP_ACCOUNT_ID`.
- `aiProxy`: HTTP function for chatbot backend. Uses Google Gemini API for intent classification (greeting, search_query, general_question, meeting_related) and context-aware search across attendees, products, companies. Requires secrets: `GEMINI_API_KEY`, `GEMINI_API_URL`, `DEFAULT_AI_MODEL`.
- Deploy: `firebase deploy --only functions` (Node 22)

### External API Integrations

- **WhatsApp API**: `apiwhatsapp.geniality.com.co` — meeting request/acceptance notifications
- **SMS API**: Onurix — meeting reminders from Cloud Functions

### UI Stack

- Mantine v7 (core, dates, modals, notifications, tiptap)
- @dnd-kit for drag-and-drop (admin field config)
- dayjs for date handling
- xlsx for Excel import/export
- @tabler/icons-react for icons
- Tiptap for rich text editing

## Environment Variables

Firebase config via Vite env vars (prefix `VITE_`):
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`
- `VITE_ENABLE_CHATBOT` — toggles chatbot tab availability (separate from policy toggle)

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
