# Listings (Chunk 1) — Landowner Draft Form

First slice of the lease-marketplace feature. Lets a signed-in landowner create
a DRAFT listing anchored to one of their existing SavedProperty rows and walk
it through a 3-step wizard. No public/discovery side yet — that is chunk 2+.

## Schema

Added to `prisma/schema.prisma`:

- `model Listing` — see below
- `enum ListingStatus { DRAFT PENDING_REVIEW PUBLISHED LEASED EXPIRED WITHDRAWN }`
- `enum LeaseType { ANNUAL SEASON_FULL RIFLE_ONLY BOW_ONLY YOUTH OTHER }`
- `enum ContactMethod { EMAIL_RELAY PHONE BOTH }`
- back-relation `listings Listing[]` on `User` and `SavedProperty`

Key columns on `Listing`:

| Column                  | Type                | Notes                                              |
| ----------------------- | ------------------- | -------------------------------------------------- |
| `id`                    | `String` cuid       | PK                                                 |
| `savedPropertyId`       | `String` FK         | required, restricts deletes                         |
| `savedPropertyUpdatedAt`| `DateTime?`         | drift tracker; refreshed on snapshot               |
| `ownerUserId`           | `String` FK         | restricts deletes                                  |
| `state`, `county`       | `String?`           | snapshot fields, all nullable for DRAFT             |
| `acres`                 | `Float?`            | snapshot                                           |
| `terrainScore`          | `Int?`              | snapshot (0-100)                                   |
| `primaryMovement`       | `String?`           | snapshot                                           |
| `bedAcres`              | `Float?`            | snapshot                                           |
| `funnelCount`           | `Int?`              | snapshot                                           |
| `askingPriceMin/Max`    | `Int?`              | dollars                                            |
| `leaseType`             | `LeaseType?`        |                                                    |
| `huntersMax`            | `Int?`              |                                                    |
| `seasonAvailability`    | `String[]`          | e.g., `['archery','rifle','muzzleloader']`         |
| `amenities`             | `Json?`             | `{ water, foodPlots, parking, ... }`               |
| `title`                 | `String?`           |                                                    |
| `description`           | `String?` (Text)    |                                                    |
| `photos`                | `String[]`          | URLs                                               |
| `contactMethod`         | `ContactMethod?`    |                                                    |
| `contactEmail/Phone`    | `String?`           |                                                    |
| `status`                | `ListingStatus`     | default `DRAFT`                                    |
| `createdAt/updatedAt`   | `DateTime`          |                                                    |
| `publishedAt`           | `DateTime?`         | set in chunk 3 publish flow                        |

Indexes: `(ownerUserId, status)` and `(state, status)`.

## OPSEC

**Listing NEVER stores precise location.** No `centroidLat`, no `centroidLng`,
no polygon, no parcel ID column. Only `state` and `county` (which the public
county-only map can render). Two automated tests guard this:

- `__tests__/listing-opsec.test.ts` — schema regex check + snapshot helper
  source check; both fail loudly if anyone adds lat/lng.

## Migration

This project applies schema changes via `prisma db push` (no migrations dir).
All Chunk 1 changes are **additive** — new table + new enums + back-relations
on existing models. Existing rows are unaffected.

```bash
cd nextjs_space
yarn prisma generate
yarn prisma db push
```

## API

- `POST /api/listings` — create DRAFT. Body: `{ savedPropertyId }`. Validates
  ownership of the SavedProperty. Returns 201 + listing JSON.
- `GET /api/listings` — list current owner's listings.
- `GET /api/listings/:id` — fetch one (must own).
- `PATCH /api/listings/:id` — update DRAFT fields. **Refuses non-DRAFT.** Uses
  `updateListingSchema.strict()` so unknown fields are rejected (centroidLat
  in particular).

All routes return `401 Unauthorized` for unauthenticated callers.

## Pages

- `/listings` — owner index, server component.
- `/listings/new` — Step 1, pick a SavedProperty. Redirects to `/listings`
  if user has zero SavedProperties (with a CTA back to `/parcel-mapping`).
- `/listings/[id]/edit?step=1|2|3` — wizard resume. Step 2 = lease terms;
  step 3 = content + contact.

## Manual Test Steps

1. Sign in as any user. (admin like `cwc2030@gmail.com` is fine.)
2. Visit `/parcel-mapping`, save at least one parcel as a SavedProperty.
3. Visit `/listings/new`. Pick the SavedProperty → submit.
4. Land on `/listings/[id]/edit?step=2`. Fill in lease terms, click *Save & continue*.
5. Land on step 3. Fill in title + description + contact, click *Finish draft*.
6. Land back on `/listings`. New row visible with status `DRAFT`.

## Test Suite

```bash
cd nextjs_space
yarn test         # vitest run
yarn test:watch   # vitest watch
```

Current: 43/43 passing (2 OPSEC + 28 zod validation + 13 API integration).

## What's NOT in Chunk 1

- No publish lifecycle (DRAFT → PENDING_REVIEW → PUBLISHED). Chunk 3.
- No public discovery / county-only map. Chunk 2.
- No photo upload (only URL storage placeholder). Chunk 2.
- No admin moderation queue. Chunk 4.
