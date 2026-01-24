import { useAccount, useSignMessage } from 'wagmi';
import { useCallback, useState, useEffect } from 'react';

/**
 * Custom hook for making authenticated admin API requests
 * Uses signature-based authentication instead of trusting headers
 */
export function useAdminFetch() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(true);

  // Clear token when wallet disconnects or changes
  useEffect(() => {
    if (!address) {
      setAuthToken(null);
      localStorage.removeItem('admin_auth_token');
      localStorage.removeItem('admin_auth_address');
      setIsValidating(false);
    } else {
      // Check if stored token is for current address
      const storedAddress = localStorage.getItem('admin_auth_address');
      if (storedAddress && storedAddress.toLowerCase() !== address.toLowerCase()) {
        // Different wallet, clear token
        setAuthToken(null);
        localStorage.removeItem('admin_auth_token');
        localStorage.removeItem('admin_auth_address');
      }
      setIsValidating(false);
    }
  }, [address]);

  // Load and validate token from localStorage on mount
  useEffect(() => {
    const validateStoredToken = async () => {
      const stored = localStorage.getItem('admin_auth_token');
      const storedAddress = localStorage.getItem('admin_auth_address');
      
      if (stored && storedAddress && address && storedAddress.toLowerCase() === address.toLowerCase()) {
        // Try to use the stored token
        try {
          const response = await fetch('/api/admin/platforms', {
            headers: { 'Authorization': `Bearer ${stored}` }
          });
          
          if (response.ok) {
            // Token is valid
            setAuthToken(stored);
          } else {
            // Token invalid, clear it
            localStorage.removeItem('admin_auth_token');
            localStorage.removeItem('admin_auth_address');
            setAuthToken(null);
          }
        } catch {
          // Error validating, clear token
          localStorage.removeItem('admin_auth_token');
          localStorage.removeItem('admin_auth_address');
          setAuthToken(null);
        }
      }
      setIsValidating(false);
    };

    if (address) {
      validateStoredToken();
    }
  }, [address]);

  const authenticate = useCallback(async () => {
    if (!address) {
      throw new Error('No wallet connected');
    }

    try {
      // Generate message to sign
      const timestamp = Date.now();
      const message = `Sign this message to authenticate as admin.\n\nWallet: ${address}\nTimestamp: ${timestamp}`;

      // Request signature from user
      const signature = await signMessageAsync({ message });

      // Verify signature with backend
      const response = await fetch('/api/admin/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Authentication failed');
      }

      const { token } = await response.json();
      setAuthToken(token);
      localStorage.setItem('admin_auth_token', token);
      localStorage.setItem('admin_auth_address', address.toLowerCase());

      return token;
    } catch (error) {
      console.error('Authentication failed:', error);
      throw error;
    }
  }, [address, signMessageAsync]);

  const adminFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      let token = authToken;

      // If no token, try to authenticate
      if (!token) {
        try {
          token = await authenticate();
        } catch (error) {
          throw new Error('Authentication required');
        }
      }

      const headers = {
        ...options.headers,
        'Authorization': `Bearer ${token}`,
      };

      const response = await fetch(url, {
        ...options,
        headers,
      });

      // If token expired, re-authenticate and retry
      if (response.status === 403 || response.status === 401) {
        try {
          // Clear invalid token
          localStorage.removeItem('admin_auth_token');
          localStorage.removeItem('admin_auth_address');
          setAuthToken(null);
          
          token = await authenticate();
          const retryHeaders = {
            ...options.headers,
            'Authorization': `Bearer ${token}`,
          };

          return fetch(url, {
            ...options,
            headers: retryHeaders,
          });
        } catch (error) {
          throw new Error('Re-authentication failed');
        }
      }

      return response;
    },
    [authToken, authenticate]
  );

  return { 
    adminFetch, 
    authenticate, 
    isAuthenticated: !!authToken,
    isValidating 
  };
}
