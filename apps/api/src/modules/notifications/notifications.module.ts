import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationProducerService } from './notification-producer.service';

@Global()
@Module({
  providers: [NotificationsService, NotificationProducerService],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
