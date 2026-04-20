import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Invite-user payload accepts **either** a pre-resolved numeric id
 * (`invitedUserId`) — legacy shape for programmatic clients — **or** a
 * `username` string. The FE (`ManageRoomModal` invitations tab +
 * `UserPopover.add-friend` carry-over) sends the latter, so BFF resolves
 * `username -> userId` server-side before forwarding to the backend's
 * `rooms.invite` RPC.
 *
 * At least one of the two must be supplied — validation is enforced with
 * `ValidateIf` so the field that is present still has to be well-formed.
 */
export class InviteUserDto {
  @ValidateIf((o: InviteUserDto) => o.username === undefined)
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  invitedUserId?: number;

  @ValidateIf((o: InviteUserDto) => o.invitedUserId === undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @IsOptional()
  username?: string;
}
