/**
 * Jest globalTeardown — stops the Testcontainers stack created in globalSetup.
 */

import { stopTestStack } from './integration-harness';

export default async function globalTeardown(): Promise<void> {
  await stopTestStack();
}
