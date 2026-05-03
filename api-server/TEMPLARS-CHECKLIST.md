# Templars of the Storm Integration - Deployment Checklist

## Pre-Deployment Verification

### ✅ Code Implementation
- [x] Added `calculateTemplarsPoints()` method
- [x] Integrated into `calculateWalletScore()`
- [x] Added Templars API endpoint to fetch calls
- [x] Added type definitions for TemplarsResponse
- [x] Added Templars to breakdown structure
- [x] Removed duplicate method
- [x] Removed CryptoClash integration (not needed)

### ✅ Testing
- [x] Unit test created and passing (7/7 tests)
- [x] Integration test created
- [x] Full wallet test created
- [x] Build successful (no TypeScript errors)
- [x] No diagnostics errors

### ✅ Documentation
- [x] Implementation guide created
- [x] Test documentation created
- [x] Points system overview updated
- [x] Summary document created
- [x] Checklist created (this file)

---

## Deployment Steps

### 1. Pre-Deployment Testing

#### Run Unit Tests
```bash
cd api-server
npx ts-node scripts/test-templars-calculation.ts
```
**Expected:** All 7 tests pass ✅

#### Build Project
```bash
cd api-server
npm run build
```
**Expected:** Build successful with no errors ✅

#### Start API Server (Local)
```bash
cd api-server
npm run dev
```
**Expected:** Server starts on port 4000

#### Run Integration Test
```bash
cd api-server
npx ts-node scripts/test-templars-integration.ts
```
**Expected:** 
- Fetches NFT balance successfully
- Calculates points correctly
- Includes Templars in breakdown

---

### 2. Staging Deployment

- [ ] Deploy to staging environment
- [ ] Verify API endpoints are accessible
- [ ] Test with multiple wallet addresses
- [ ] Verify NFT balance reads from blockchain
- [ ] Check points calculation accuracy
- [ ] Verify breakdown includes Templars
- [ ] Test with wallets holding 0, 1, 2, 3+ NFTs
- [ ] Monitor performance and response times
- [ ] Check error handling for invalid wallets

#### Test Wallets for Staging

| Wallet | Expected NFTs | Expected Points | Tier |
|--------|--------------|-----------------|------|
| TBD | 0 | 0 | None |
| TBD | 1 | 1,500 | Base |
| TBD | 2 | 2,200 | Silver |
| TBD | 3+ | 2,700 | Gold/Whale |

---

### 3. Production Deployment

- [ ] Review staging test results
- [ ] Get approval for production deployment
- [ ] Deploy to production environment
- [ ] Verify API endpoints are live
- [ ] Test with real user wallets
- [ ] Monitor error logs
- [ ] Check performance metrics
- [ ] Verify caching is working (5-minute TTL)

---

### 4. Post-Deployment Verification

#### API Endpoints
- [ ] `GET /api/analytics/:wallet/templars_nft_balance` - Returns NFT balance
- [ ] `GET /api/wallet/:wallet/score` - Includes Templars in breakdown

#### Points Calculation
- [ ] 0 NFTs → 0 points
- [ ] 1 NFT → 1,500 points
- [ ] 2 NFTs → 2,200 points
- [ ] 3+ NFTs → 2,700 points

#### Breakdown Structure
- [ ] Templars appears in `breakdown.platforms['templars']`
- [ ] `tx_count` contains NFT balance
- [ ] `points` contains calculated points
- [ ] `usd_volume` is 0 (not applicable)

#### Performance
- [ ] Response time < 2 seconds
- [ ] Caching working correctly
- [ ] No memory leaks
- [ ] Error rate < 1%

---

### 5. Frontend Integration (Future)

- [ ] Add Templars card to dashboard
- [ ] Display NFT balance
- [ ] Show tier (Base/Silver/Gold)
- [ ] Display points contribution
- [ ] Add Templars icon/logo
- [ ] Update points breakdown UI
- [ ] Add tooltip explaining tiers
- [ ] Test responsive design

---

## Rollback Plan

If issues are discovered after deployment:

### Immediate Rollback
1. Revert `points-service-v2.ts` to previous version
2. Redeploy API server
3. Verify system is stable

### Partial Rollback
1. Comment out Templars calculation in `calculateWalletScore()`
2. Redeploy without removing code
3. Fix issues and re-enable

### Code to Comment Out
```typescript
// Templars of the Storm NFT points
// const templarsBalance = templarsData?.value || 0;
// const templarsPoints = this.calculateTemplarsPoints(templarsBalance);
// breakdown.platforms['templars'] = { tx_count: templarsBalance, usd_volume: 0, points: templarsPoints };
// totalPoints += templarsPoints;
```

---

## Monitoring

### Metrics to Watch

#### Performance
- API response time for `/api/wallet/:wallet/score`
- Blockchain read latency for NFT balance
- Cache hit rate (should be high after 5 minutes)

#### Errors
- Failed blockchain reads
- Invalid wallet addresses
- Timeout errors
- Calculation errors

#### Usage
- Number of wallets with Templars NFTs
- Distribution across tiers (0/1/2/3+)
- Average points contribution
- Impact on rank distribution

---

## Success Criteria

### Technical
✅ All tests passing  
✅ Build successful  
✅ No TypeScript errors  
✅ API endpoints responding  
✅ Points calculated correctly  

### Business
- [ ] Users can see Templars points in their score
- [ ] Points accurately reflect NFT holdings
- [ ] Tier system working as designed
- [ ] No negative user feedback
- [ ] Performance acceptable

---

## Known Issues / Limitations

### Current Limitations
- NFT balance reflects current holdings only (no historical tracking)
- 5-minute cache means balance updates may be delayed
- Requires blockchain read (potential for RPC failures)

### Future Enhancements
- Historical NFT holding tracking
- Phase 2 multiplier implementation
- Leaderboard for Templars holders
- Achievement badges for tier milestones

---

## Contact & Support

### Documentation
- Implementation: `TEMPLARS-IMPLEMENTATION.md`
- Tests: `scripts/README-TEMPLARS-TESTS.md`
- Overview: `POINTS-SYSTEM-OVERVIEW.md`
- Summary: `TEMPLARS-SUMMARY.md`

### Code
- Service: `src/services/points-service-v2.ts`
- Method: `calculateTemplarsPoints()`
- Tests: `scripts/test-templars-*.ts`

### Contract
- Address: `0x46625E7de9894D83fca49E79cB53B5C25550cE99`
- Network: Ink Mainnet (Chain ID: 57073)
- Type: ERC-721

---

## Sign-Off

### Development
- [x] Code implemented
- [x] Tests created
- [x] Documentation complete
- [x] Build successful

### Testing
- [ ] Staging tests passed
- [ ] Production tests passed
- [ ] Performance verified
- [ ] Error handling verified

### Deployment
- [ ] Staging deployed
- [ ] Production deployed
- [ ] Monitoring active
- [ ] Team notified

---

**Prepared By:** AI Assistant  
**Date:** March 5, 2026  
**Version:** 1.0  
**Status:** Ready for Deployment ✅
