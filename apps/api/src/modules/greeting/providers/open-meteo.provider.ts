import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { WeatherProvider, WeatherSnapshot } from './weather.provider.interface';

const WMO: Record<number, { condition: string; icon: string; summary: string }> = {
  0: { condition: 'clear', icon: 'clear', summary: 'Clear sky' },
  1: { condition: 'mostly_clear', icon: 'mostly_clear', summary: 'Mostly clear' },
  2: { condition: 'partly_cloudy', icon: 'partly_cloudy', summary: 'Partly cloudy' },
  3: { condition: 'overcast', icon: 'cloudy', summary: 'Overcast' },
  45: { condition: 'fog', icon: 'fog', summary: 'Fog' },
  48: { condition: 'fog', icon: 'fog', summary: 'Depositing rime fog' },
  51: { condition: 'drizzle', icon: 'rain', summary: 'Light drizzle' },
  61: { condition: 'rain', icon: 'rain', summary: 'Light rain' },
  63: { condition: 'rain', icon: 'rain', summary: 'Rain' },
  65: { condition: 'rain', icon: 'rain', summary: 'Heavy rain' },
  71: { condition: 'snow', icon: 'snow', summary: 'Light snow' },
  73: { condition: 'snow', icon: 'snow', summary: 'Snow' },
  75: { condition: 'snow', icon: 'snow', summary: 'Heavy snow' },
  80: { condition: 'showers', icon: 'rain', summary: 'Rain showers' },
  95: { condition: 'thunderstorm', icon: 'thunderstorm', summary: 'Thunderstorm' },
};

@Injectable()
export class OpenMeteoProvider implements WeatherProvider {
  async fetch(lat: number, lng: number): Promise<WeatherSnapshot> {
    const res = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: { latitude: lat, longitude: lng, current: 'temperature_2m,weather_code', temperature_unit: 'celsius' },
      timeout: 4000,
    });
    const current = res.data?.current ?? {};
    const tempC = Math.round(Number(current.temperature_2m ?? 0));
    const tempF = Math.round((tempC * 9) / 5 + 32);
    const code = Number(current.weather_code ?? 0);
    const meta = WMO[code] ?? { condition: 'unknown', icon: 'unknown', summary: 'Unknown conditions' };
    return { tempC, tempF, ...meta };
  }
}
