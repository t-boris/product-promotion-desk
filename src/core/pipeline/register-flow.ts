import type { Core } from '../core'

/**
 * Registers the discussion → draft → approval → sending flow (I-4, I-5, I-6): monitor, drafting, review,
 * gate and sending services plus the opportunities.*, publications.*, channels.discussions,
 * channels.selectOlder, channels.activate, channels.checkNow and channels.setPaused handlers.
 * Placeholder until the flow work lands.
 */
export function registerFlow(_core: Core): void {}
