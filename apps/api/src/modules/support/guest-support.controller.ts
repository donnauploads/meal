import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { Public } from '../auth/decorators/public.decorator';
import { JwtCryptoService } from '../crypto/jwt.service';
import { SupportService } from './support.service';

class OpenGuestThreadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsEmail()
  @MaxLength(200)
  email!: string;
}

class GuestMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

type MessageRow = {
  id: string;
  threadId: string;
  senderId: string | null;
  senderRole: string;
  body: string;
  createdAt: Date;
};

function toWire(m: MessageRow) {
  return {
    id: m.id,
    threadId: m.threadId,
    senderId: m.senderId,
    senderRole: m.senderRole,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * Unauthenticated GUEST support chat (logged-out visitors). A thread is
 * created from a name/email intake; the response includes a signed guest
 * token that the browser stores and sends back in the `x-guest-token`
 * header — possession of a valid token for a thread IS the authorization
 * (the global JwtAccessGuard is bypassed here via `@Public()`).
 *
 * Admins see + reply to these threads in the normal admin support queue;
 * replies stream back to the guest's socket room in real time.
 */
@Public()
@Controller('support/guest')
export class GuestSupportController {
  constructor(
    private readonly support: SupportService,
    private readonly jwt: JwtCryptoService,
  ) {}

  /** Start a guest thread. Returns the thread id + a capability token. */
  @Post('thread')
  async open(@Body() dto: OpenGuestThreadDto) {
    const thread = await this.support.openGuestThread(dto.name, dto.email);
    return {
      id: thread.id,
      status: thread.status,
      token: this.jwt.signGuestSupport(thread.id),
      createdAt: thread.createdAt.toISOString(),
    };
  }

  @Get('thread/:id/messages')
  async messages(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-guest-token') token?: string,
  ) {
    this.assertOwns(id, token);
    const rows = (await this.support.listGuestMessages(id)) as MessageRow[];
    return rows.map(toWire);
  }

  @Post('thread/:id/messages')
  async send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GuestMessageDto,
    @Headers('x-guest-token') token?: string,
  ) {
    this.assertOwns(id, token);
    const message = (await this.support.postGuestMessage(
      id,
      dto.body,
    )) as MessageRow;
    return toWire(message);
  }

  /** Verify the guest token authorizes access to this exact thread. */
  private assertOwns(threadId: string, token?: string) {
    if (!token) throw new UnauthorizedException('Missing guest token');
    let tid: string;
    try {
      tid = this.jwt.verifyGuestSupport(token).tid;
    } catch {
      throw new UnauthorizedException('Invalid guest token');
    }
    if (tid !== threadId) {
      throw new UnauthorizedException('Token does not match thread');
    }
  }
}
