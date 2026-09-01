export interface WeatherSnapshot {
  tempC: number;
  tempF: number;
  condition: string;
  icon: string;
  summary: string;
}

export interface WeatherProvider {
  fetch(lat: number, lng: number): Promise<WeatherSnapshot>;
}

export const WEATHER_PROVIDER = Symbol('WEATHER_PROVIDER');
