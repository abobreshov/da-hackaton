import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/**
 * Validates that a `:param` is a positive bigint-shaped decimal string and
 * passes it through unchanged (no JS Number conversion — preserves precision
 * for ids that exceed `Number.MAX_SAFE_INTEGER`).
 *
 * Use on message ids and any other surrogate key that may exceed 2^53 once
 * the snowflake / bigserial range warms up. The downstream service still sees
 * a plain decimal string so the JSON wire format is unchanged.
 */
@Injectable()
export class ParseBigIntPipe implements PipeTransform<string, string> {
  transform(value: string, _metadata: ArgumentMetadata): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new BadRequestException('id must be a numeric string');
    }
    if (!/^[1-9][0-9]*$/.test(value)) {
      throw new BadRequestException('id must be a positive integer string');
    }
    try {
      const parsed = BigInt(value);
      if (parsed <= 0n) {
        throw new BadRequestException('id must be positive');
      }
    } catch {
      throw new BadRequestException('id must be a valid bigint');
    }
    return value;
  }
}
