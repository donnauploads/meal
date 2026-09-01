import { Global, Module } from '@nestjs/common';
import { AdminNotificationsService } from './admin-notifications.service';

@Global()
@Module({
  providers: [AdminNotificationsService],
  exports: [AdminNotificationsService],
})
export class AdminNotificationsModule {}
