import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useEscrowContract, useEscrowBalance } from './useEscrowBalance';
import { fromSorobanInt } from '@/utils/currencyFormatter';

// Mock fetch
global.fetch = vi.fn();

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useEscrowBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        totalLocked: '1000000000', // 100.0000000 in Soroban
        available: '500000000',    // 50.0000000 in Soroban
        pendingRelease: '0',
        asset: 'USDC',
        contractId: 'test-contract-123',
      }),
    });
  });

  it('should fetch and return escrow balance', async () => {
    const { result } = renderHook(() => useEscrowBalance('test-contract-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({
      totalLocked: '1000000000',
      available: '500000000',
      pendingRelease: '0',
      asset: 'USDC',
      contractId: 'test-contract-123',
    });
  });
});

describe('useEscrowContract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should rollback balance exactly to pre-deposit state (7 decimal places) on failed deposit', async () => {
    // Initial balance: totalLocked = 100.0000000, available = 50.0000000 (Soroban format: 1000000000, 500000000)
    const initialBalance = {
      totalLocked: '1000000000', // 100.0000000
      available: '500000000',    // 50.0000000
      pendingRelease: '0',
      asset: 'USDC',
      contractId: 'test-contract-123',
    };

    // Mock fetch to fail for deposit
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => initialBalance,
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Deposit failed' }),
      });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    // Pre-populate query cache with initial balance
    await queryClient.prefetchQuery({
      queryKey: ['escrowBalance', 'test-contract-123'],
      queryFn: async () => initialBalance,
    });

    const { result } = renderHook(() => useEscrowContract('test-contract-123'), { wrapper });

    // Perform deposit mutation with fractional amount (1.2345678 → Soroban: 12345678)
    await act(async () => {
      try {
        await result.current.depositMutation.mutateAsync({
          contractId: 'test-contract-123',
          amount: '12345678', // 1.2345678 in display
          asset: 'USDC',
          publicKey: 'GTEST123',
        });
      } catch (e) {
        // Expected to fail
      }
    });

    // Wait for mutation to settle and cache to rollback
    await waitFor(() => {
      expect(result.current.depositMutation.isError).toBe(true);
    });

    // Get current balance from cache
    const finalBalance = queryClient.getQueryData(['escrowBalance', 'test-contract-123']);

    // Verify that balance is exactly restored (check both Soroban and display formats)
    expect(finalBalance).toEqual(initialBalance);
    expect(fromSorobanInt(finalBalance!.totalLocked)).toBe('100.0000000');
    expect(fromSorobanInt(finalBalance!.available)).toBe('50.0000000');
  });
});
