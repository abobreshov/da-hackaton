import { SetMetadata } from '@nestjs/common';

export const SCOPES_KEY = 'required_scopes';

/**
 * Require the authenticated user to have ALL listed scopes.
 * Usage: @RequireScopes('read:users', 'write:users')
 */
export const RequireScopes = (...scopes: string[]) => SetMetadata(SCOPES_KEY, scopes);
