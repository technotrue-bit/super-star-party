import { inject } from "@vercel/analytics";

/** Hobby pageviews only — no track() custom events. */
export const ANALYTICS_PAGEVIEWS_ONLY = true as const;

/**
 * Vercel Web Analytics. Production loads /_vercel/insights/script.js after
 * Analytics is enabled on the Vercel project and a deployment is created.
 */
inject();
