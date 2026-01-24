import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';

/**
 * Client-side hook to check if connected wallet is admin
 * Makes server-side API call to avoid exposing admin wallet list
 */
export function useIsAdmin() {
  const { address, isConnected } = useAccount();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    if (!address || !isConnected) {
      setIsAdmin(false);
      setIsChecking(false);
      return;
    }

    const checkAdmin = async () => {
      setIsChecking(true);
      try {
        const response = await fetch(`/api/admin/check?address=${address}`);
        const data = await response.json();
        setIsAdmin(data.isAdmin || false);
      } catch (error) {
        console.error('Failed to check admin status:', error);
        setIsAdmin(false);
      } finally {
        setIsChecking(false);
      }
    };

    checkAdmin();
  }, [address, isConnected]);

  return { isAdmin, isChecking };
}
