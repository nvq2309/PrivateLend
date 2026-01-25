export const isE2e = () => {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  const fromParams = params.get('e2e') === '1';
  const fromEnv = import.meta.env.MODE === 'e2e' || import.meta.env.VITE_E2E_TEST_MODE === 'true';
  const fromGlobal = typeof (window as any).__VEILLEND_E2E_WALLET_PUBLIC_KEY__ !== 'undefined';
  return fromParams || fromEnv || fromGlobal;
};

export const shouldMockAdapters = () => {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  // Mock adapters if explicitly requested OR if in E2E test mode
  return params.get('mock') === '1' || isE2e();
};
