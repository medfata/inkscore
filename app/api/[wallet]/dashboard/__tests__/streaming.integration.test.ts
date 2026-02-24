import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GET } from '../route';
import { NextRequest } from 'next/server';

// Mock fetch for Express API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Helper to create a mock NextRequest
function createMockRequest(wallet: string, stream: boolean = true): NextRequest {
  const url = `http://localhost:3000/api/${wallet}/dashboard${stream ? '?stream=true' : ''}`;
  return new NextRequest(url);
}

// Helper to read SSE stream
async function readSSEStream(response: Response): Promise<any[]> {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  const events: any[] = [];
  
  if (!reader) {
    throw new Error('No reader available');
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        try {
          events.push(JSON.parse(data));
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
  }
  
  return events;
}

describe('Dashboard Streaming Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set default mock to return successful responses
    mockFetch.mockImplementation((url: string) => {
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: `mock data for ${url}` }),
      });
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Full Stream Lifecycle', () => {
    it('should stream all 27 metrics progressively', async () => {
      const wallet = '0x1234567890123456789012345678901234567890';
      const request = createMockRequest(wallet, true);
      const params = Promise.resolve({ wallet });

      const response = await GET(request, { params });

      expect(response.headers.get('Content-Type')).toBe('text/event-stream');
      expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
      expect(response.headers.get('Connection')).toBe('keep-alive');

      const events = await readSSEStream(response);

      // Should have 27 metric events + 1 done event = 28 total
      expect(events.length).toBe(28);

      // Check that all expected metrics are present
      const metricIds = events
        .filter((e) => e.type === 'metric')
        .map((e) => e.id);

      expect(metricIds).toContain('stats');
      expect(metricIds).toContain('bridge');
      expect(metricIds).toContain('swap');
      expect(metricIds).toContain('volume');
      expect(metricIds).toContain('score');
      expect(metricIds).toContain('analytics');
      expect(metricIds).toContain('cards');
      expect(metricIds).toContain('marvk');
      expect(metricIds).toContain('nado');
      expect(metricIds).toContain('copink');
      expect(metricIds).toContain('nft2me');
      expect(metricIds).toContain('tydro');
      expect(metricIds).toContain('gmCount');
      expect(metricIds).toContain('inkypumpCreatedTokens');
      expect(metricIds).toContain('inkypumpBuyVolume');
      expect(metricIds).toContain('inkypumpSellVolume');
      expect(metricIds).toContain('nftTraded');
      expect(metricIds).toContain('zns');
      expect(metricIds).toContain('shelliesJoinedRaffles');
      expect(metricIds).toContain('shelliesPayToPlay');
      expect(metricIds).toContain('shelliesStaking');
      expect(metricIds).toContain('openseaBuyCount');
      expect(metricIds).toContain('mintCount');
      expect(metricIds).toContain('openseaSaleCount');
      expect(metricIds).toContain('inkdcaRunDca');
      expect(metricIds).toContain('templarsNftBalance');
      expect(metricIds).toContain('cowswapSwaps');

      // Last event should be 'done'
      const lastEvent = events[events.length - 1];
      expect(lastEvent.type).toBe('done');
      expect(lastEvent.totalDuration).toBeGreaterThan(0);
      expect(lastEvent.timedOut).toBe(false);
    }, 10000);

    it('should include proper event structure for each metric', async () => {
      const wallet = '0x1234567890123456789012345678901234567890';
      const request = createMockRequest(wallet, true);
      const params = Promise.resolve({ wallet });

      const response = await GET(request, { params });
      const events = await readSSEStream(response);

      const metricEvents = events.filter((e) => e.type === 'metric');

      metricEvents.forEach((event) => {
        expect(event).toHaveProperty('type', 'metric');
        expect(event).toHaveProperty('id');
        expect(event).toHaveProperty('data');
        expect(event).toHaveProperty('error');
        expect(event).toHaveProperty('duration');
        expect(event).toHaveProperty('timestamp');
        expect(typeof event.id).toBe('string');
        expect(typeof event.duration).toBe('number');
        expect(typeof event.timestamp).toBe('number');
      });
    }, 10000);
  });

  describe('Error Handling', () => {
    it('should handle some metrics failing without breaking the stream', async () => {
      // Mock some endpoints to fail
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('cowswap_swaps') || url.includes('tydro')) {
          return Promise.resolve({
            ok: false,
            status: 500,
            json: async () => ({}),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: `mock data for ${url}` }),
        });
      });

      const wallet = '0x1234567890123456789012345678901234567890';
      const request = createMockRequest(wallet, true);
      const params = Promise.resolve({ wallet });

      const response = await GET(request, { params });
      const events = await readSSEStream(response);

      // Should still have all events (some with errors)
      expect(events.length).toBe(28);

      // Check for error events
      const cowswapEvent = events.find((e) => e.id === 'cowswapSwaps');
      const tydroEvent = events.find((e) => e.id === 'tydro');

      expect(cowswapEvent).toBeDefined();
      expect(cowswapEvent?.error).toBe('HTTP 500');
      expect(cowswapEvent?.data).toBeNull();

      expect(tydroEvent).toBeDefined();
      expect(tydroEvent?.error).toBe('HTTP 500');
      expect(tydroEvent?.data).toBeNull();

      // Other metrics should succeed
      const statsEvent = events.find((e) => e.id === 'stats');
      expect(statsEvent?.error).toBeNull();
      expect(statsEvent?.data).toBeDefined();

      // Stream should complete successfully
      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();
      expect(doneEvent?.timedOut).toBe(false);
    }, 10000);

    it('should handle network errors for individual metrics', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('bridge')) {
          return Promise.reject(new Error('Network timeout'));
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: `mock data for ${url}` }),
        });
      });

      const wallet = '0x1234567890123456789012345678901234567890';
      const request = createMockRequest(wallet, true);
      const params = Promise.resolve({ wallet });

      const response = await GET(request, { params });
      const events = await readSSEStream(response);

      const bridgeEvent = events.find((e) => e.id === 'bridge');
      expect(bridgeEvent).toBeDefined();
      expect(bridgeEvent?.error).toBe('Network timeout');
      expect(bridgeEvent?.data).toBeNull();

      // Stream should still complete
      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();
    }, 10000);
  });

  describe('Timeout Scenarios', () => {
    it('should timeout after 30 seconds if metrics take too long', async () => {
      // Mock some endpoints to take a very long time
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('cowswap_swaps')) {
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                json: async () => ({ data: 'slow data' }),
              });
            }, 35000); // 35 seconds - longer than timeout
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: `mock data for ${url}` }),
        });
      });

      const wallet = '0x1234567890123456789012345678901234567890';
      const request = createMockRequest(wallet, true);
      const params = Promise.resolve({ wallet });

      const startTime = Date.now();
      const response = await GET(request, { params });
      const events = await readSSEStream(response);
      const duration = Date.now() - startTime;

      // Should complete in approximately 30 seconds (with some tolerance)
      expect(duration).toBeLessThan(32000);
      expect(duration).toBeGreaterThan(28000);

      // Done event should indicate timeout
      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();
      expect(doneEvent?.timedOut).toBe(true);
    }, 35000);
  });

  describe('Fallback to Non-Streaming', () => {
    it('should use non-streaming mode when stream parameter is not set', async () => {
      const wallet = '0x1234567890123456789012345678901234567890';
      const request = createMockRequest(wallet, false);
      const params = Promise.resolve({ wallet });

      const response = await GET(request, { params });

      // Should return JSON, not SSE
      expect(response.headers.get('Content-Type')).toContain('application/json');

      const data = await response.json();

      // Should have all metrics in a single object
      expect(data).toHaveProperty('stats');
      expect(data).toHaveProperty('bridge');
      expect(data).toHaveProperty('swap');
      expect(data).toHaveProperty('cowswapSwaps');
      // ... etc
    }, 10000);

    it('should validate wallet address format', async () => {
      const invalidWallet = 'invalid-wallet';
      const request = createMockRequest(invalidWallet, true);
      const params = Promise.resolve({ wallet: invalidWallet });

      const response = await GET(request, { params });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Invalid wallet address format');
    });
  });

  describe('Connection Interruption', () => {
    it('should handle stream being closed early', async () => {
      const wallet = '0x1234567890123456789012345678901234567890';
      const request = createMockRequest(wallet, true);
      const params = Promise.resolve({ wallet });

      const response = await GET(request, { params });
      const reader = response.body?.getReader();

      if (!reader) {
        throw new Error('No reader available');
      }

      // Read a few events then cancel
      const decoder = new TextDecoder();
      let eventsRead = 0;

      while (eventsRead < 5) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        if (chunk.includes('data: ')) {
          eventsRead++;
        }
      }

      // Cancel the stream early
      await reader.cancel();

      // Should not throw errors
      expect(eventsRead).toBeGreaterThan(0);
      expect(eventsRead).toBeLessThan(28);
    }, 10000);
  });

  describe('Performance Characteristics', () => {
    it('should stream metrics as they complete, not all at once', async () => {
      // Mock endpoints with different delays
      mockFetch.mockImplementation((url: string) => {
        const delay = url.includes('stats') ? 100 : 
                     url.includes('bridge') ? 200 : 
                     url.includes('cowswap') ? 500 : 50;
        
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              json: async () => ({ data: `mock data for ${url}` }),
            });
          }, delay);
        });
      });

      const wallet = '0x1234567890123456789012345678901234567890';
      const request = createMockRequest(wallet, true);
      const params = Promise.resolve({ wallet });

      const response = await GET(request, { params });
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (!reader) {
        throw new Error('No reader available');
      }

      const eventTimestamps: number[] = [];
      let eventCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        if (chunk.includes('data: ')) {
          eventTimestamps.push(Date.now());
          eventCount++;
        }
      }

      // Should have received events progressively
      expect(eventCount).toBeGreaterThan(0);

      // Check that events arrived over time (not all at once)
      if (eventTimestamps.length > 1) {
        const firstEventTime = eventTimestamps[0];
        const lastEventTime = eventTimestamps[eventTimestamps.length - 1];
        const totalTime = lastEventTime - firstEventTime;

        // Events should be spread over at least 100ms
        expect(totalTime).toBeGreaterThan(100);
      }
    }, 10000);

    it('should include duration metadata for each metric', async () => {
      const wallet = '0x1234567890123456789012345678901234567890';
      const request = createMockRequest(wallet, true);
      const params = Promise.resolve({ wallet });

      const response = await GET(request, { params });
      const events = await readSSEStream(response);

      const metricEvents = events.filter((e) => e.type === 'metric');

      metricEvents.forEach((event) => {
        expect(event.duration).toBeGreaterThanOrEqual(0);
        expect(typeof event.duration).toBe('number');
      });

      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent?.totalDuration).toBeGreaterThanOrEqual(0);
    }, 10000);
  });
});
