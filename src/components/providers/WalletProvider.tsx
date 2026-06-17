'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  WatchWalletChanges,
  getAddress as freighterGetAddress,
  getNetwork as freighterGetNetwork,
} from '@stellar/freighter-api';
import type { WalletMetrics, AssetBalance } from '@/types';

interface WalletContextValue {
  metrics: WalletMetrics | null;
  isConnecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshBalances: (publicKey: string) => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

async function getFreighterPublicKey(): Promise<string> {
  const result = await freighterGetAddress();
  if (result.error) throw new Error(result.error.message ?? 'Freighter connection failed');
  return result.address;
}

async function getFreighterNetwork(): Promise<'testnet' | 'mainnet' | 'futurenet'> {
  const result = await freighterGetNetwork();
  if (result.error) throw new Error(result.error.message ?? 'Failed to get network');
  const network = result.network;
  if (network !== 'testnet' && network !== 'mainnet' && network !== 'futurenet') {
    return 'testnet';
  }
  return network;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [metrics, setMetrics] = useState<WalletMetrics | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const publicKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const watcher = new WatchWalletChanges(2000);
    watcher.watch((params) => {
      if (params.address && params.address !== publicKeyRef.current) {
        generationRef.current += 1;
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        publicKeyRef.current = params.address;
        setMetrics(null);
        setError(null);
        setIsConnecting(false);
        queryClient.clear();
      }
    });
    return () => {
      watcher.stop();
    };
  }, [queryClient]);

  const refreshBalances = useCallback(async (pk: string) => {
    const response = await fetch(`/api/wallet/balances?publicKey=${pk}`);
    if (response.ok) {
      const balances: AssetBalance[] = await response.json();
      setMetrics((prev) => (prev ? { ...prev, balances } : null));
    }
  }, []);

  const connect = useCallback(async () => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const generation = ++generationRef.current;

    setIsConnecting(true);
    setError(null);

    try {
      const publicKey = await getFreighterPublicKey();
      if (controller.signal.aborted || generation !== generationRef.current) return;

      const network = await getFreighterNetwork();
      if (controller.signal.aborted || generation !== generationRef.current) return;

      const response = await fetch(`/api/wallet/balances?publicKey=${publicKey}`);
      const balances: AssetBalance[] = response.ok ? await response.json() : [];

      if (!controller.signal.aborted && generation === generationRef.current) {
        publicKeyRef.current = publicKey;
        queryClient.clear();
        setMetrics({ publicKey, balances, network, isConnected: true });
      }
    } catch (err) {
      if (!controller.signal.aborted && generation === generationRef.current) {
        setError(err instanceof Error ? err.message : 'Wallet connection failed');
      }
    } finally {
      if (!controller.signal.aborted && generation === generationRef.current) {
        setIsConnecting(false);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    }
  }, [queryClient]);

  const disconnect = useCallback(async () => {
    generationRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    publicKeyRef.current = null;
    setMetrics(null);
    setError(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  return (
    <WalletContext.Provider
      value={{ metrics, isConnecting, error, connect, disconnect, refreshBalances }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}
