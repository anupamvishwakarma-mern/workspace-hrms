import { ApiClient } from './api';
import { API_URL } from './config';
import { sessionStorage } from './session-storage';

type Listener = () => void;
const expiredListeners = new Set<Listener>();
export const onSessionExpired = (fn: Listener) => {
  expiredListeners.add(fn);
  return () => void expiredListeners.delete(fn);
};

export const api = new ApiClient({
  baseUrl: API_URL,
  storage: sessionStorage,
  onSessionExpired: () => expiredListeners.forEach((fn) => fn()),
});
