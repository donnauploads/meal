import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { WeatherProvider, WeatherSnapshot } from './weather.provider.interface';

@Injectable()
export class OpenWeatherProvider implements WeatherProvider {
  constructor(private readonly config: ConfigService) {}

  async fetch(lat: number, lng: number): Promise<WeatherSnapshot> {
    const key = this.config.get<string>('OPENWEATHER_API_KEY');
    if (!key) throw new Error('OPENWEATHER_API_KEY not configured');
    const res = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
      params: { lat, lon: lng, appid: key, units: 'metric' },
      timeout: 4000,
    });
    const tempC = Math.round(Number(res.data?.main?.temp ?? 0));
    const tempF = Math.round((tempC * 9) / 5 + 32);
    const w = res.data?.weather?.[0] ?? {};
    const main = String(w.main ?? 'unknown').toLowerCase();
    return {
      tempC,
      tempF,
      condition: main,
      icon: w.icon ?? main,
      summary: w.description ?? main,
    };
  }
}
