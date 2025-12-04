import { create } from 'zustand';

interface UserState {
  address?: `0x${string}`;
  setAddress: (addr?: `0x${string}`) => void;
}

export const useUserStore = create<UserState>((set) => ({
  address: undefined,
  setAddress: (addr) => set({ address: addr })
}));