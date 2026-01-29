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

This is a React + Vite meetings/networking app for events, using **Firebase** as backend (Firestore, Auth, Storage, FCM) and **Mantine** for UI components.

### Core Entities (Firestore Collections)

- **events/{eventId}**: Event config (scheduling, formFields, registrationForm, policies)
- **events/{eventId}/companies/{nitNorm}**: Companies (razonSocial, logoUrl, fixedTable)
- **events/{eventId}/meetings**: Meeting requests (requesterId, receiverId, status, productId?, companyId?, contextNote?)
- **events/{eventId}/products**: Products (ownerUserId, companyId, title, description, imageUrl)
- **users**: Global collection, filtered by `eventId`. Attendees with companyId, tipoAsistente, etc.
- **agenda**: Global collection, filtered by `eventId`. Slots with tableNumber, startTime, endTime, available, meetingId
- **locks**: Prevents double-booking: lockId = `{eventId}_{userId}_{date}_{start}-{end}`
- **notifications**, **meetingSurveys**, **config/generalSettings**

### Event Policies (event.config.policies)

Configurable per event via admin panel (`EventPoliciesModal.tsx`):
- `roleMode`: "open" | "buyer_seller" — who can meet whom
- `tableMode`: "pool" | "fixed" — table assignment (pool=auto, fixed=company-assigned)
- `discoveryMode`: "all" | "by_role" — directory visibility
- `schedulingMode`: "manual" | "auto"
- `uiViewsEnabled`: { attendees, companies, products } — which dashboard views are shown

Defaults defined in `DEFAULT_POLICIES` in `src/pages/dashboard/types.ts`.

### Key Directories

- `src/firebase/` — Firebase configuration, exports `db`, `auth`, `storage`, `messaging`
- `src/context/UserContext.jsx` — Auth state (anonymous auth + manual login by cedula/email)
- `src/utils/` — Utilities (companyStorage.ts for logo upload)
- `src/pages/admin/` — Admin panel: event management, attendees, meetings, policies config
- `src/pages/dashboard/` — Attendee dashboard with 3 discovery views + activity tabs
- `src/components/` — Shared components (UserProfile)

### Dashboard Architecture

`Dashboard.tsx` → `useDashboardData.ts` (hook) → `TabsPanel.tsx` (view router)

**TabsPanel** uses a `SegmentedControl` with 4 sections driven by `policies.uiViewsEnabled`:
1. **Directorio** (`AttendeesView.tsx`) — Card-based attendee list with search/filters
2. **Empresas** (`CompaniesView.tsx`) — Companies grouped by NIT with logo, representatives, meeting CTA
3. **Productos** (`ProductsView.tsx`) — Product catalog with company/text filters, meeting CTA with context
4. **Mi actividad** — Tabs for: Reuniones (`MeetingsTab`), Solicitudes (`RequestsTab`), Mis productos (`MyProductsTab`)

Meeting requests from CompaniesView/ProductsView pass context (productId, companyId, contextNote).

### Data Flow

- `UserContext` provides `currentUser`, `loginByCedula()`, `loginByEmail()`, `logout()`
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

### UI Stack

- Mantine v7 (core, dates, modals, notifications, tiptap)
- @dnd-kit for drag-and-drop (admin field config)
- dayjs for date handling
- xlsx for Excel import/export

## Environment Variables

Firebase config via Vite env vars (prefix `VITE_`):
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`

## Code Conventions

- Mixed JSX (JavaScript) and TSX (TypeScript) — new files should be .tsx
- Spanish used in variable names, comments, and UI text
- ESLint configured for React with hooks rules
- Types defined centrally in `src/pages/dashboard/types.ts`

## Extending the System

- **New dashboard view**: Add to `uiViewsEnabled` in types.ts, create `XxxView.tsx`, add to `TabsPanel.tsx` SegmentedControl
- **New role mode**: Add value to `roleMode` in EventPolicies, update filtering in useDashboardData effect #5
- **New event policy**: Add to EventPolicies interface + DEFAULT_POLICIES, add UI in EventPoliciesModal
