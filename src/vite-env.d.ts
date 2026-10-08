interface ImportMetaEnv {
  /**
   * Worker origin for cross-network friends rooms.
   * Empty or unset keeps the BroadcastChannel playtest relay.
   * Example: https://ssp-party.<account>.workers.dev
   */
  readonly VITE_PARTY_URL?: string;
  /**
   * Set to "1" on a production build when a probe must use the contact hook.
   * Dev servers allow the hook without this. Shipped builds ignore it.
   */
  readonly VITE_SSP_TEST?: string;
}
