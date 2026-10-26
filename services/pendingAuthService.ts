type PendingEmailAuth = {
  kind: 'email';
  email: string;
  password: string;
};

type PendingSocialAuth = {
  kind: 'social';
  provider: 'google' | 'facebook';
};

export type PendingAuthRequest = PendingEmailAuth | PendingSocialAuth;

let pendingRequest: PendingAuthRequest | null = null;

export const setPendingEmailAuth = (email: string, password: string) => {
  pendingRequest = { kind: 'email', email, password };
};

export const setPendingSocialAuth = (provider: PendingSocialAuth['provider']) => {
  pendingRequest = { kind: 'social', provider };
};

export const takePendingAuthRequest = () => {
  const request = pendingRequest;
  pendingRequest = null;
  return request;
};

export const clearPendingAuthRequest = () => {
  pendingRequest = null;
};
