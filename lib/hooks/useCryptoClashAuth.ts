import { useState, useEffect } from 'react';
import { useAccount, useSignMessage } from 'wagmi';

interface CryptoClashAuthState {
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  error: string | null;
  authenticate: () => Promise<void>;
}

export function useCryptoClashAuth(): CryptoClashAuthState {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if already authenticated on mount
  useEffect(() => {
    if (address) {
      checkAuthStatus();
    }
  }, [address]);

  const checkAuthStatus = async () => {
    if (!address) return;

    try {
      // Try to fetch data - if it works, we're authenticated
      const response = await fetch(`/api/cryptoclash/${address}`);
      const data = await response.json();
      
      // If requiresAuth is not set, we're authenticated
      setIsAuthenticated(!data.requiresAuth);
    } catch (err) {
      setIsAuthenticated(false);
    }
  };

  const authenticate = async () => {
    if (!address) {
      setError('No wallet connected');
      return;
    }

    setIsAuthenticating(true);
    setError(null);

    try {
      // Create message with current timestamp
      const timestamp = Date.now();
      const message = `Sign in to Crypto Clash\nTimestamp: ${timestamp}`;

      // Request wallet signature
      const signature = await signMessageAsync({ message });

      // Send authentication request to our backend
      const response = await fetch('/api/cryptoclash/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: address,
          signature,
          message,
          timestamp,
        }),
      });

      if (!response.ok) {
        throw new Error('Authentication failed');
      }

      const data = await response.json();

      if (data.success) {
        setIsAuthenticated(true);
        setError(null);
      } else {
        throw new Error('Authentication failed');
      }
    } catch (err) {
      console.error('CryptoClash authentication error:', err);
      setError(err instanceof Error ? err.message : 'Authentication failed');
      setIsAuthenticated(false);
    } finally {
      setIsAuthenticating(false);
    }
  };

  return {
    isAuthenticated,
    isAuthenticating,
    error,
    authenticate,
  };
}
