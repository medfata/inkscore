/**
 * Browser Compatibility Utilities
 * 
 * Detects browser capabilities and provides fallback mechanisms
 * for features that may not be supported in all browsers.
 */

/**
 * Check if EventSource (Server-Sent Events) is supported
 */
export function isEventSourceSupported(): boolean {
  return typeof EventSource !== 'undefined';
}

/**
 * Detect browser type and version
 */
export function detectBrowser(): {
  name: string;
  version: string;
  isChrome: boolean;
  isFirefox: boolean;
  isSafari: boolean;
  isEdge: boolean;
  isMobile: boolean;
} {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      name: 'unknown',
      version: 'unknown',
      isChrome: false,
      isFirefox: false,
      isSafari: false,
      isEdge: false,
      isMobile: false,
    };
  }

  const ua = navigator.userAgent;
  const isMobile = /Mobile|Android|iPhone|iPad|iPod/i.test(ua);

  // Detect Edge
  const isEdge = /Edg\//.test(ua);
  if (isEdge) {
    const version = ua.match(/Edg\/(\d+)/)?.[1] || 'unknown';
    return {
      name: 'Edge',
      version,
      isChrome: false,
      isFirefox: false,
      isSafari: false,
      isEdge: true,
      isMobile,
    };
  }

  // Detect Chrome
  const isChrome = /Chrome\//.test(ua) && !/Edg\//.test(ua);
  if (isChrome) {
    const version = ua.match(/Chrome\/(\d+)/)?.[1] || 'unknown';
    return {
      name: 'Chrome',
      version,
      isChrome: true,
      isFirefox: false,
      isSafari: false,
      isEdge: false,
      isMobile,
    };
  }

  // Detect Firefox
  const isFirefox = /Firefox\//.test(ua);
  if (isFirefox) {
    const version = ua.match(/Firefox\/(\d+)/)?.[1] || 'unknown';
    return {
      name: 'Firefox',
      version,
      isChrome: false,
      isFirefox: true,
      isSafari: false,
      isEdge: false,
      isMobile,
    };
  }

  // Detect Safari
  const isSafari = /Safari\//.test(ua) && !/Chrome\//.test(ua) && !/Edg\//.test(ua);
  if (isSafari) {
    const version = ua.match(/Version\/(\d+)/)?.[1] || 'unknown';
    return {
      name: 'Safari',
      version,
      isChrome: false,
      isFirefox: false,
      isSafari: true,
      isEdge: false,
      isMobile,
    };
  }

  return {
    name: 'unknown',
    version: 'unknown',
    isChrome: false,
    isFirefox: false,
    isSafari: false,
    isEdge: false,
    isMobile,
  };
}

/**
 * Check if the browser supports streaming features adequately
 */
export function isStreamingSupported(): boolean {
  // Check for EventSource support
  if (!isEventSourceSupported()) {
    return false;
  }

  // Check for fetch support (needed for fallback)
  if (typeof fetch === 'undefined') {
    return false;
  }

  return true;
}

/**
 * Get browser-specific recommendations for streaming
 */
export function getStreamingRecommendations(): {
  shouldUseStreaming: boolean;
  reason: string;
} {
  if (!isEventSourceSupported()) {
    return {
      shouldUseStreaming: false,
      reason: 'EventSource not supported in this browser',
    };
  }

  const browser = detectBrowser();

  // All modern browsers support streaming well
  if (browser.isChrome || browser.isEdge || browser.isFirefox || browser.isSafari) {
    return {
      shouldUseStreaming: true,
      reason: `${browser.name} has full EventSource support`,
    };
  }

  // Unknown browser but has EventSource
  if (isEventSourceSupported()) {
    return {
      shouldUseStreaming: true,
      reason: 'EventSource is available',
    };
  }

  return {
    shouldUseStreaming: false,
    reason: 'Browser compatibility unknown',
  };
}

/**
 * Log browser compatibility information
 */
export function logBrowserInfo(): void {
  if (typeof window === 'undefined') return;

  const browser = detectBrowser();
  const eventSourceSupported = isEventSourceSupported();
  const streamingSupported = isStreamingSupported();

  console.log('[Browser Compat] Browser:', browser.name, browser.version);
  console.log('[Browser Compat] Mobile:', browser.isMobile);
  console.log('[Browser Compat] EventSource supported:', eventSourceSupported);
  console.log('[Browser Compat] Streaming supported:', streamingSupported);

  const recommendations = getStreamingRecommendations();
  console.log('[Browser Compat] Recommendation:', recommendations.reason);
}
