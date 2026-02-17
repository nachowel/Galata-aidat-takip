# Due Drift Index Contract

## Scope
This document defines the Firestore query/index contract for due aggregate drift detection and rebuild flows.

## Drift Queries
- `managements/{mgmtId}/ledger`
  - `where("source", "==", "dues").orderBy("dueAggregationUpdatedAt", "desc").limit(5)`
  - fallback: `where("source", "==", "dues").orderBy("createdAt", "desc").limit(5)`
- `managements/{mgmtId}/dueAllocations`
  - `where("dueId", "==", dueId)` for canonical due allocation sum.

## Required Composite Indexes
Defined in `firestore.indexes.json`:

1. `ledger` / `COLLECTION`
   - `source ASC`
   - `dueAggregationUpdatedAt DESC`

2. `ledger` / `COLLECTION`
   - `source ASC`
   - `createdAt DESC`

## CI Guard
- Script: `scripts/verify-firestore-indexes.mjs`
- CI step fails merge if required drift indexes are missing.

## Alert Key Policy
- Path: `managements/{mgmtId}/dueDriftAlerts/{dueId}`
- Decision: **latest-state overwrite** (not event history) for now.
- Drift fingerprint fields:
  - `canonicalHash`
  - `cachedHash`
  - `diffHash`
  - `driftCount`

If history is required later, add:
- `managements/{mgmtId}/dueDriftAlerts/{dueId}/events/{eventId}`
