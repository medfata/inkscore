# Quick Guide: Add Auth to Remaining Admin Routes

To protect all admin API routes, add these two lines to each route file:

## Step 1: Add Import
At the top of the file, add:
```typescript
import { checkAdminAuth } from '@/lib/admin-api-auth';
```

## Step 2: Add Auth Check
At the start of each handler function (GET, POST, PUT, DELETE), add:
```typescript
const authError = checkAdminAuth(request);
if (authError) return authError;
```

## Example:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/admin-api-auth';

export async function GET(request: NextRequest) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;
  
  // Your existing code...
}

export async function POST(request: NextRequest) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;
  
  // Your existing code...
}
```

## Routes to Update:
- [ ] `/api/admin/metrics/route.ts`
- [ ] `/api/admin/metrics/[id]/route.ts`
- [ ] `/api/admin/platforms/[id]/route.ts`
- [ ] `/api/admin/platforms/contracts/route.ts`
- [ ] `/api/admin/platforms/contracts/[address]/route.ts`
- [ ] `/api/admin/points/rules/route.ts`
- [ ] `/api/admin/points/rules/[id]/route.ts`
- [ ] `/api/admin/points/ranks/route.ts`
- [ ] `/api/admin/points/ranks/[id]/route.ts`
- [ ] `/api/admin/points/native-metrics/route.ts`
- [ ] `/api/admin/dashboard/cards/route.ts`
- [ ] `/api/admin/assets/route.ts`
- [ ] `/api/admin/backfill/route.ts`
- [ ] And any other admin API routes...
