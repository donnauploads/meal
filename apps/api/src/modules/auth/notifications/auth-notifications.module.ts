import { Module } from '@nestjs/common';
import { AuthNotificationsService } from './auth-notifications.service';

@Module({
  providers: [AuthNotificationsService],
  exports: [AuthNotificationsService],
})
export class AuthNotificationsModule {}
