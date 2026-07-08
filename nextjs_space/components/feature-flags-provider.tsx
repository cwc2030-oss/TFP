'use client';

/**
 * Client-side feature-flag context.
 *
 * Server-only env flags (read at request time in the root layout, a Node
 * server component) are handed down to client components — notably the
 * navbar — through this context. This keeps the flags out of the client
 * bundle (no NEXT_PUBLIC_ inlining) while still letting client UI react to
 * them, and lets a single env flip + redeploy flip the UI everywhere.
 */

import { createContext, useContext, type ReactNode } from 'react';

export type FeatureFlags = {
  /** Whether the county-level Deer Flow browsing page/tab is enabled. */
  countyDeerFlowEnabled: boolean;
};

const DEFAULT_FLAGS: FeatureFlags = {
  countyDeerFlowEnabled: false,
};

const FeatureFlagsContext = createContext<FeatureFlags>(DEFAULT_FLAGS);

export function FeatureFlagsProvider({
  value,
  children,
}: {
  value: FeatureFlags;
  children: ReactNode;
}) {
  return (
    <FeatureFlagsContext.Provider value={value}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFeatureFlags(): FeatureFlags {
  return useContext(FeatureFlagsContext);
}
