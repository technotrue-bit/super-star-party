interface ImportMetaEnv {
  /**
   * Worker origin for cross-network friends rooms.
   * Empty or unset keeps the BroadcastChannel playtest relay.
   * Example: https://ssp-party.<account>.workers.dev
   */
  readonly VITE_PARTY_URL?: string;
}
