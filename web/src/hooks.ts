import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Batch, Contact, ContactDetail, Message, ProfileData } from './types';

export interface ProfileResponse {
  data: ProfileData;
  resume: { id: string; filename: string; size: number } | null;
}

export const useProfile = () => useQuery({ queryKey: ['profile'], queryFn: () => api<ProfileResponse>('/profile') });
export const useContacts = () => useQuery({ queryKey: ['contacts'], queryFn: () => api<Contact[]>('/contacts') });
export const useContact = (id: number) => useQuery({ queryKey: ['contact', id], queryFn: () => api<ContactDetail>(`/contacts/${id}`) });
export const useBatches = () => useQuery({ queryKey: ['batches'], queryFn: () => api<Batch[]>('/batches') });
export const useMessages = (status?: string, step?: number) =>
  useQuery({
    queryKey: ['messages', status ?? '', step ?? ''],
    queryFn: () => api<Message[]>(`/messages?${new URLSearchParams({ ...(status ? { status } : {}), ...(step !== undefined ? { step: String(step) } : {}) })}`),
  });
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<{ email: string | null; gmailConnected: boolean }>('/me'), retry: false });
