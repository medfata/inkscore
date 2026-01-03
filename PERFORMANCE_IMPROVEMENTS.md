# Simplified Performance Fix

## Problem
The `/api/admin/indexing/progress` endpoint was taking 1.5+ minutes due to:
1. Complex API calls to external services
2. Unnecessary data processing

## Solution
Simplified the endpoint to:
1. Just fetch basic contract info from the `contracts` table
2. Remove all external API calls
3. Return simple status information

## New API Endpoints for Metrics
- `GET /api/admin/metrics/contracts` - Get all contracts for metrics configuration
- `GET /api/admin/metrics/contracts/[address]/functions` - Get distinct functions for a contract

## Expected Performance
- From ~1.5 minutes to ~100-500ms
- No external API dependencies
- Simple database queries only

The admin page now has:
- **Contracts tab**: Simple contract listing from database
- **Metrics tab**: Can select contracts and fetch their functions dynamically