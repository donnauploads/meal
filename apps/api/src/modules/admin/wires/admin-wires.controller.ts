import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAccessGuard } from '../../auth/guards/jwt-access.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { AdminWiresService } from './admin-wires.service';
import { ReverseWireDto, WireBeneficiaryDto } from '../dto/admin.dto';

@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.superadmin)
@Controller('admin/wires')
export class AdminWiresController {
  constructor(private readonly svc: AdminWiresService) {}

  // ─── Beneficiaries ──────────────────────────────────────────────────────

  @Get('beneficiaries')
  listBeneficiaries() {
    return this.svc.listBeneficiaries();
  }

  @Post('beneficiaries')
  createBeneficiary(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: WireBeneficiaryDto,
  ) {
    return this.svc.createBeneficiary(user.sub, dto);
  }

  @Patch('beneficiaries/:id')
  updateBeneficiary(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WireBeneficiaryDto,
  ) {
    return this.svc.updateBeneficiary(id, dto);
  }

  @Delete('beneficiaries/:id')
  @HttpCode(204)
  deleteBeneficiary(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteBeneficiary(id);
  }

  // ─── Wires ──────────────────────────────────────────────────────────────

  @Get()
  listWires(@Query('limit') limit?: string) {
    return this.svc.listWires(limit ? Number(limit) : undefined);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string } = {},
  ) {
    return this.svc.approve(user.sub, id, body?.reason);
  }

  @Post(':id/reverse')
  @HttpCode(200)
  reverse(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseWireDto,
  ) {
    return this.svc.reverse(user.sub, id, dto);
  }
}
