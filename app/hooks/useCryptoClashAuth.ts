import { useState, useEffect, useCallback } from 'react';
import { useSignMessage } from 'wagmi';

interface CryptoClashAuthState {
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  error: string | null;
  authenticate: () => Promise<void>;
  checkAuth: () => Promise<boolean>;
}

const STORAGE_KEY_PREFIX = 'cryptoclash_token_expiry_';
const TOKEN_EXPIRY_MS = 23 * 60 * 60 * 1000; // 23 hours

export function useCryptoClashAuth(
  walletAddress: string | undefined,
  onAuthSuccess?: () => void
): CryptoClashAuthState {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { signMessageAsync } = useSignMessage();

  // Check if token is expired in localStorage
  const isTokenExpired = useCallback((address: string): boolean => {
    if (typeof window === 'undefined') return true;
    
    const storageKey = `${STORAGE_KEY_PREFIX}${address.toLowerCase()}`;
    const expiryStr = localStorage.getItem(storageKey);
    
    if (!expiryStr) return true;
    
    const expiry = parseInt(expiryStr, 10);
    return Date.now() >= expiry;
  }, []);

  // Store token expiry in localStorage
  const storeTokenExpiry = useCallback((address: string) => {
    if (typeof window === 'undefined') return;
    
    const storageKey = `${STORAGE_KEY_PREFIX}${address.toLowerCase()}`;
    const expiry = Date.now() + TOKEN_EXPIRY_MS;
    localStorage.setItem(storageKey, expiry.toString());
  }, []);

  // Check authentication status
  const checkAuth = useCallback(async (): Promise<boolean> => {
    if (!walletAddress) {
      setIsAuthenticated(false);
      return false;
    }

    // First check localStorage for performance
    if (!isTokenExpired(walletAddress)) {
      setIsAuthenticated(true);
      return true;
    }

    // If localStorage says expired, verify with backend
    try {
      const response = await fetch(`/api/cryptoclash/${walletAddress}`);
      
      if (!response.ok) {
        setIsAuthenticated(false);
        return false;
      }

      const data = await response.json();
      
      if (data.requiresAuth) {
        setIsAuthenticated(false);
        return false;
      }

      // Backend says we're authenticated, update localStorage
      storeTokenExpiry(walletAddress);
      setIsAuthenticated(true);
      return true;
    } catch (err) {
      setIsAuthenticated(false);
      return false;
    }
  }, [walletAddress, isTokenExpired, storeTokenExpiry]);

  // Authenticate with signature
  const authenticate = useCallback(async () => {
    if (!walletAddress) {
      setError('No wallet connected');
      return;
    }

    setIsAuthenticating(true);
    setError(null);

    try {
      // Create message with timestamp
      const timestamp = Date.now();
      const message = `Sign in to Crypto Clash\nTimestamp: ${timestamp}`;

      // Request signature from wallet
      const signature = await signMessageAsync({ message });

      // Send authentication request to backend
      const authResponse = await fetch('/api/cryptoclash/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: walletAddress,
          signature,
          message,
          timestamp,
        }),
      });

      if (!authResponse.ok) {
        const errorData = await authResponse.json();
        throw new Error(errorData.error || 'Authentication failed');
      }

      // Store token expiry in localStorage
      storeTokenExpiry(walletAddress);
      setIsAuthenticated(true);
      setError(null);

      // Call success callback if provided
      if (onAuthSuccess) {
        onAuthSuccess();
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
      setIsAuthenticated(false);
    } finally {
      setIsAuthenticating(false);
    }
  }, [walletAddress, signMessageAsync, storeTokenExpiry, onAuthSuccess]);

  // Check auth status on mount and when wallet changes
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return {
    isAuthenticated,
    isAuthenticating,
    error,
    authenticate,
    checkAuth,
  };
}
