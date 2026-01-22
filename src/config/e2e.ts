export const isE2e = () => {
  const queryFlag =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('e2e') === '1';
  return import.meta.env.MODE === 'e2e' || import.meta.env.VITE_E2E_TEST_MODE === 'true' || queryFlag;
};
