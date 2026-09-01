import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GreetingService } from './greeting.service';
import { GreetingController } from './greeting.controller';
import { OpenMeteoProvider } from './providers/open-meteo.provider';
import { OpenWeatherProvider } from './providers/openweather.provider';
import { WEATHER_PROVIDER } from './providers/weather.provider.interface';

@Module({
  providers: [
    GreetingService,
    OpenMeteoProvider,
    OpenWeatherProvider,
    {
      provide: WEATHER_PROVIDER,
      inject: [ConfigService, OpenMeteoProvider, OpenWeatherProvider],
      useFactory: (config: ConfigService, om: OpenMeteoProvider, ow: OpenWeatherProvider) =>
        config.get<string>('WEATHER_PROVIDER') === 'openweather' ? ow : om,
    },
  ],
  controllers: [GreetingController],
  exports: [GreetingService],
})
export class GreetingModule {}
