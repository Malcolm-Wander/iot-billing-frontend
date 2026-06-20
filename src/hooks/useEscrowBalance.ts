'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { EscrowBalance } from '@/types';
import BigNumber from 'bignumber.js';
import { fromSorobanInt, toSorobanInt } from '@/utils/currencyFormatter';

async function fetchEscrowBalance(contractId: string): Promise<EscrowBalance> {
  const response = await fetch(`/api/escrow/${contractId}/balance`);
  if (!response.ok) throw new Error('Failed to fetch escrow balance');
  return response.json();
}

export function useEscrowBalance(contractId: string) {
  return useQuery({
    queryKey: ['escrowBalance', contractId],
    queryFn: () => fetchEscrowBalance(contractId),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

async function depositEscrow(params: {
  contractId: string;
  amount: string;
  asset: string;
  publicKey: string;
}) {
  const response = await fetch('/api/escrow/deposit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error('Deposit failed');
  return response.json();
}

async function withdrawEscrow(params: {
  contractId: string;
  amount: string;
  asset: string;
  publicKey: string;
}) {
  const response = await fetch('/api/escrow/withdraw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error('Withdrawal failed');
  return response.json();
}

async function simulateContract(params: {
  contractId: string;
  amount: string;
  asset: string;
  publicKey: string;
  operation: 'escrow_deposit' | 'escrow_withdrawal';
}) {
  const response = await fetch('/api/escrow/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error('Simulation failed');
  return response.json();
}

export function useEscrowContract(contractId: string) {
  const queryClient = useQueryClient();

  const depositMutation = useMutation({
    mutationFn: depositEscrow,
    onMutate: async (params: {
      contractId: string;
      amount: string;
      asset: string;
      publicKey: string;
    }) => {
      await queryClient.cancelQueries({ queryKey: ['escrowBalance', contractId] });
      const previous = queryClient.getQueryData<EscrowBalance>(['escrowBalance', contractId]);
      if (previous) {
        // Convert to display values for BigNumber arithmetic
        const prevTotalLocked = new BigNumber(fromSorobanInt(previous.totalLocked));
        const prevAvailable = new BigNumber(fromSorobanInt(previous.available));
        const paramAmount = new BigNumber(fromSorobanInt(params.amount));

        const optimistic: EscrowBalance = {
          ...previous,
          totalLocked: toSorobanInt(prevTotalLocked.plus(paramAmount)),
          available: toSorobanInt(prevAvailable.minus(paramAmount)),
        };
        queryClient.setQueryData(['escrowBalance', contractId], optimistic);
      }
      return { previous };
    },
    onError: (
      _err: Error,
      _params: { contractId: string; amount: string; asset: string; publicKey: string },
      context: { previous: EscrowBalance | undefined } | undefined,
    ) => {
      if (context?.previous) {
        queryClient.setQueryData(['escrowBalance', contractId], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['escrowBalance', contractId] });
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: withdrawEscrow,
    onMutate: async (params: {
      contractId: string;
      amount: string;
      asset: string;
      publicKey: string;
    }) => {
      await queryClient.cancelQueries({ queryKey: ['escrowBalance', contractId] });
      const previous = queryClient.getQueryData<EscrowBalance>(['escrowBalance', contractId]);
      if (previous) {
        // Convert to display values for BigNumber arithmetic
        const prevTotalLocked = new BigNumber(fromSorobanInt(previous.totalLocked));
        const prevAvailable = new BigNumber(fromSorobanInt(previous.available));
        const paramAmount = new BigNumber(fromSorobanInt(params.amount));

        const optimistic: EscrowBalance = {
          ...previous,
          totalLocked: toSorobanInt(prevTotalLocked.minus(paramAmount)),
          available: toSorobanInt(prevAvailable.plus(paramAmount)),
        };
        queryClient.setQueryData(['escrowBalance', contractId], optimistic);
      }
      return { previous };
    },
    onError: (
      _err: Error,
      _params: { contractId: string; amount: string; asset: string; publicKey: string },
      context: { previous: EscrowBalance | undefined } | undefined,
    ) => {
      if (context?.previous) {
        queryClient.setQueryData(['escrowBalance', contractId], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['escrowBalance', contractId] });
    },
  });

  return { depositMutation, withdrawMutation, simulateContract };
}
