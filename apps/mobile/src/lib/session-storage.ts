import * as SecureStore from 'expo-secure-store';
import type { SessionStorage } from './api';

const REFRESH = 'wf.refreshToken';
const TENANT = 'wf.tenantId';
const PENDING = 'wf.pendingPunch';
// Keychain/Keystore, not AsyncStorage; not readable by other apps and excluded from unencrypted backups.
const opts: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const sessionStorage: SessionStorage = {
  getRefreshToken: () => SecureStore.getItemAsync(REFRESH, opts),
  setRefreshToken: (t) => SecureStore.setItemAsync(REFRESH, t, opts),
  clear: async () => {
    await Promise.all([REFRESH, TENANT, PENDING].map((k) => SecureStore.deleteItemAsync(k, opts)));
  },
};

export const tenantPref = {
  get: () => SecureStore.getItemAsync(TENANT, opts),
  set: (id: string) => SecureStore.setItemAsync(TENANT, id, opts),
};

export const pendingPunchStore = {
  get: () => SecureStore.getItemAsync(PENDING, opts),
  set: (v: string) => SecureStore.setItemAsync(PENDING, v, opts),
  clear: () => SecureStore.deleteItemAsync(PENDING, opts),
};
