import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert';
import { RealtimeService, Contract, ContractPollingState } from '../RealtimeService.js';

/**
 * Test suite for RealtimeService
 * 
 * Tests the adaptive exponential backoff polling algorithm:
 * - Starts at 15 seconds interval
 * - Doubles interval when no new transactions found (up to 10 min max)
 * - Resets to 15 seconds when new transactions are found
 */

describe('RealtimeService Configuration', () => {
    let service: RealtimeService;

    before(() => {
        service = new RealtimeService();
    });

    it('should have correct default configuration', () => {
        const config = service.getConfig();

        console.log('\n⚙️ Configuration:');
        console.log(`   Base interval: ${config.baseIntervalMs}ms (${config.baseIntervalMs / 1000}s)`);
        console.log(`   Max interval: ${config.maxIntervalMs}ms (${config.maxIntervalMs / 1000}s)`);
        console.log(`   Backoff multiplier: ${config.backoffMultiplier}x`);

        assert.strictEqual(config.baseIntervalMs, 15_000, 'Base interval should be 15 seconds');
        assert.strictEqual(config.maxIntervalMs, 600_000, 'Max interval should be 10 minutes');
        assert.strictEqual(config.backoffMultiplier, 2, 'Backoff multiplier should be 2');
    });
});

describe('RealtimeService Polling State Initialization', () => {
    let service: RealtimeService;

    beforeEach(() => {
        service = new RealtimeService();
        service.resetPollingState();
    });

    it('should initialize new contract with base interval and lastPollTime=0', () => {
        const contractId = 1;
        const state = service.getPollingState(contractId);

        console.log('\n📊 Initial state for new contract:');
        console.log(`   lastPollTime: ${state.lastPollTime}`);
        console.log(`   intervalMs: ${state.intervalMs}ms`);
        console.log(`   consecutiveEmptyPolls: ${state.consecutiveEmptyPolls}`);

        assert.strictEqual(state.lastPollTime, 0, 'New contract should have lastPollTime=0 (poll immediately)');
        assert.strictEqual(state.intervalMs, 15_000, 'New contract should start with base interval');
        assert.strictEqual(state.consecutiveEmptyPolls, 0, 'New contract should have 0 empty polls');
    });

    it('should return same state object for same contract', () => {
        const contractId = 42;
        const state1 = service.getPollingState(contractId);
        const state2 = service.getPollingState(contractId);

        assert.strictEqual(state1, state2, 'Should return same state object for same contract');
    });

    it('should maintain separate state for different contracts', () => {
        const state1 = service.getPollingState(1);
        const state2 = service.getPollingState(2);

        // Back off contract 1 (empty poll)
        service.updatePollingState(1, 0, false);

        const updatedState1 = service.getPollingState(1);
        const updatedState2 = service.getPollingState(2);

        console.log('\n📊 Contract 1 state after empty poll:', updatedState1);
        console.log('📊 Contract 2 state (unchanged):', updatedState2);

        assert.strictEqual(updatedState1.intervalMs, 30_000,
            'Contract 1 should have backed off to 30s');
        assert.strictEqual(updatedState2.intervalMs, 15_000,
            'Contract 2 should still be at base interval');
    });
});

describe('RealtimeService Adaptive Exponential Backoff', () => {
    let service: RealtimeService;
    const contractId = 1;

    beforeEach(() => {
        service = new RealtimeService();
        service.resetPollingState();
    });

    it('should reset to base interval when new transactions found', () => {
        // First, back off a few times
        service.updatePollingState(contractId, 0, false); // 15s -> 30s
        service.updatePollingState(contractId, 0, false); // 30s -> 60s
        service.updatePollingState(contractId, 0, false); // 60s -> 120s

        const stateBeforeReset = service.getPollingState(contractId);
        console.log(`\n📊 Interval after 3 empty polls: ${stateBeforeReset.intervalMs}ms`);

        // Now find new transactions
        service.updatePollingState(contractId, 5, false);

        const stateAfterReset = service.getPollingState(contractId);
        console.log(`📊 Interval after finding 5 new tx: ${stateAfterReset.intervalMs}ms`);

        assert.strictEqual(stateAfterReset.intervalMs, 15_000,
            'Should reset to base interval when new transactions found');
        assert.strictEqual(stateAfterReset.consecutiveEmptyPolls, 0,
            'Should reset consecutiveEmptyPolls to 0');
    });

    it('should double interval on empty poll (exponential backoff)', () => {
        const config = service.getConfig();

        console.log('\n📊 Exponential backoff progression:');

        // Poll 1: 15s -> 30s
        service.updatePollingState(contractId, 0, false);
        let state = service.getPollingState(contractId);
        console.log(`   After poll 1 (empty): ${state.intervalMs}ms`);
        assert.strictEqual(state.intervalMs, 30_000, 'Should be 30s after 1 empty poll');

        // Poll 2: 30s -> 60s
        service.updatePollingState(contractId, 0, false);
        state = service.getPollingState(contractId);
        console.log(`   After poll 2 (empty): ${state.intervalMs}ms`);
        assert.strictEqual(state.intervalMs, 60_000, 'Should be 60s after 2 empty polls');

        // Poll 3: 60s -> 120s
        service.updatePollingState(contractId, 0, false);
        state = service.getPollingState(contractId);
        console.log(`   After poll 3 (empty): ${state.intervalMs}ms`);
        assert.strictEqual(state.intervalMs, 120_000, 'Should be 120s after 3 empty polls');

        // Poll 4: 120s -> 240s
        service.updatePollingState(contractId, 0, false);
        state = service.getPollingState(contractId);
        console.log(`   After poll 4 (empty): ${state.intervalMs}ms`);
        assert.strictEqual(state.intervalMs, 240_000, 'Should be 240s after 4 empty polls');

        // Poll 5: 240s -> 480s
        service.updatePollingState(contractId, 0, false);
        state = service.getPollingState(contractId);
        console.log(`   After poll 5 (empty): ${state.intervalMs}ms`);
        assert.strictEqual(state.intervalMs, 480_000, 'Should be 480s after 5 empty polls');
    });

    it('should cap interval at MAX_INTERVAL_MS (10 minutes)', () => {
        console.log('\n📊 Testing max interval cap:');

        // Simulate many empty polls to hit the cap
        for (let i = 0; i < 10; i++) {
            service.updatePollingState(contractId, 0, false);
            const state = service.getPollingState(contractId);
            console.log(`   After poll ${i + 1}: ${state.intervalMs}ms (${(state.intervalMs / 1000).toFixed(0)}s)`);
        }

        const finalState = service.getPollingState(contractId);
        assert.strictEqual(finalState.intervalMs, 600_000,
            'Should cap at 600000ms (10 minutes)');
    });

    it('should back off on error', () => {
        const initialState = service.getPollingState(contractId);
        console.log(`\n📊 Initial interval: ${initialState.intervalMs}ms`);

        service.updatePollingState(contractId, 0, true); // Error!

        const stateAfterError = service.getPollingState(contractId);
        console.log(`📊 Interval after error: ${stateAfterError.intervalMs}ms`);

        assert.strictEqual(stateAfterError.intervalMs, 30_000,
            'Should double interval on error');
        assert.strictEqual(stateAfterError.consecutiveEmptyPolls, 1,
            'Should increment consecutiveEmptyPolls on error');
    });

    it('should track consecutiveEmptyPolls correctly', () => {
        console.log('\n📊 Tracking consecutiveEmptyPolls:');

        for (let i = 1; i <= 5; i++) {
            service.updatePollingState(contractId, 0, false);
            const state = service.getPollingState(contractId);
            console.log(`   After ${i} empty polls: consecutiveEmptyPolls = ${state.consecutiveEmptyPolls}`);
            assert.strictEqual(state.consecutiveEmptyPolls, i,
                `Should have ${i} consecutive empty polls`);
        }

        // Reset with new transactions
        service.updatePollingState(contractId, 3, false);
        const resetState = service.getPollingState(contractId);
        console.log(`   After finding 3 tx: consecutiveEmptyPolls = ${resetState.consecutiveEmptyPolls}`);
        assert.strictEqual(resetState.consecutiveEmptyPolls, 0,
            'Should reset to 0 when transactions found');
    });
});

describe('RealtimeService Contract Priority Selection', () => {
    let service: RealtimeService;

    beforeEach(() => {
        service = new RealtimeService();
        service.resetPollingState();
    });

    it('should select most overdue contract for polling', async () => {
        const contracts: Contract[] = [
            { id: 1, address: '0x111', name: 'Contract A' },
            { id: 2, address: '0x222', name: 'Contract B' },
            { id: 3, address: '0x333', name: 'Contract C' },
        ];

        // Initialize all contracts with different last poll times
        const now = Date.now();

        // Contract 1: polled 20 seconds ago (overdue by 5s with 15s interval)
        service.getPollingState(1);
        service.updatePollingState(1, 1, false); // Reset to base interval
        (service.getPollingState(1) as any).lastPollTime = now - 20_000;

        // Contract 2: polled 10 seconds ago (not yet due with 15s interval)
        service.getPollingState(2);
        service.updatePollingState(2, 1, false);
        (service.getPollingState(2) as any).lastPollTime = now - 10_000;

        // Contract 3: polled 30 seconds ago (overdue by 15s with 15s interval)
        service.getPollingState(3);
        service.updatePollingState(3, 1, false);
        (service.getPollingState(3) as any).lastPollTime = now - 30_000;

        console.log('\n📊 Contract polling states:');
        for (const c of contracts) {
            const state = service.getPollingState(c.id);
            const timeSinceLastPoll = now - state.lastPollTime;
            const overdueBy = timeSinceLastPoll - state.intervalMs;
            console.log(`   ${c.name}: last poll ${(timeSinceLastPoll / 1000).toFixed(0)}s ago, overdue by ${(overdueBy / 1000).toFixed(0)}s`);
        }

        const nextContract = service.getNextContractToPoll(contracts);

        console.log(`\n✅ Selected: ${nextContract?.name}`);

        assert.strictEqual(nextContract?.id, 3,
            'Should select Contract C (most overdue)');
    });

    it('should return null if no contracts are due for polling', () => {
        const contracts: Contract[] = [
            { id: 1, address: '0x111', name: 'Contract A' },
        ];

        // Just polled, not due yet
        service.updatePollingState(1, 1, false);

        const nextContract = service.getNextContractToPoll(contracts);

        console.log('\n📊 No contracts due for polling');
        console.log(`   Result: ${nextContract}`);

        assert.strictEqual(nextContract, null,
            'Should return null when no contracts are due');
    });

    it('should prioritize new contracts (lastPollTime=0)', () => {
        const contracts: Contract[] = [
            { id: 1, address: '0x111', name: 'Existing Contract' },
            { id: 2, address: '0x222', name: 'New Contract' },
        ];

        // Contract 1: recently polled
        service.updatePollingState(1, 1, false);

        // Contract 2: never polled (new)
        service.getPollingState(2); // Just initialize, don't update

        const nextContract = service.getNextContractToPoll(contracts);

        console.log('\n📊 New contract should be prioritized');
        console.log(`   Selected: ${nextContract?.name}`);

        assert.strictEqual(nextContract?.id, 2,
            'Should prioritize new contract (never polled)');
    });
});

describe('RealtimeService API Integration', () => {
    let service: RealtimeService;

    before(() => {
        service = new RealtimeService();
    });

    it('should fetch transactions from Routescan API', async () => {
        // Use a known active contract on Ink chain (DailyGM)
        const testAddress = '0x9F500d075118272B3564ac6Ef2c70a9067Fd2d3F';

        console.log('\n🌐 Testing API fetch...');
        console.log(`   Address: ${testAddress}`);

        try {
            const transactions = await service.fetchLatestTransactions(testAddress);

            console.log(`   Fetched: ${transactions.length} transactions`);

            if (transactions.length > 0) {
                const tx = transactions[0];
                console.log(`   First tx hash: ${tx.txHash || tx.id}`);
                console.log(`   First tx timestamp: ${tx.timestamp}`);
                console.log(`   First tx from: ${tx.from}`);
                console.log(`   First tx method: ${tx.method}`);
            }

            assert.ok(Array.isArray(transactions), 'Should return an array');
        } catch (error: any) {
            console.log(`   Error: ${error.message}`);
            throw error;
        }
    });
});

describe('RealtimeService Polling Stats', () => {
    let service: RealtimeService;

    beforeEach(() => {
        service = new RealtimeService();
        service.resetPollingState();
    });

    it('should return polling stats for all tracked contracts', () => {
        // Initialize some contracts
        service.updatePollingState(1, 5, false);
        service.updatePollingState(2, 0, false);
        service.updatePollingState(3, 0, true);

        const stats = service.getPollingStats();

        console.log('\n📊 Polling stats:');
        for (const stat of stats) {
            console.log(`   Contract ${stat.contractId}: interval=${stat.intervalMs}ms, emptyPolls=${stat.consecutiveEmptyPolls}`);
        }

        assert.strictEqual(stats.length, 3, 'Should have stats for 3 contracts');

        const contract1Stats = stats.find(s => s.contractId === 1);
        const contract2Stats = stats.find(s => s.contractId === 2);
        const contract3Stats = stats.find(s => s.contractId === 3);

        assert.strictEqual(contract1Stats?.intervalMs, 15_000, 'Contract 1 should be at base interval');
        assert.strictEqual(contract2Stats?.intervalMs, 30_000, 'Contract 2 should be backed off');
        assert.strictEqual(contract3Stats?.intervalMs, 30_000, 'Contract 3 should be backed off (error)');
    });
});
