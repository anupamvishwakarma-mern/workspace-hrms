import { Platform } from 'react-native';

/**
 * Link that opens a punch location in the phone's own maps app. The coordinates go only to that app,
 * and only when the person taps the button: this app loads no map tiles and calls no map service.
 */
export function mapUrl(
  latitude: number,
  longitude: number,
  os: string = Platform.OS,
  label = 'Punch location',
): string {
  const ll = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  if (os === 'ios') return `https://maps.apple.com/?ll=${ll}&q=${encodeURIComponent(label)}`;
  if (os === 'android') return `geo:${ll}?q=${ll}(${encodeURIComponent(label)})`;
  return `https://www.openstreetmap.org/?mlat=${latitude.toFixed(6)}&mlon=${longitude.toFixed(6)}#map=17/${latitude.toFixed(6)}/${longitude.toFixed(6)}`;
}

export function formatCoords(latitude: number, longitude: number): string {
  const f = (n: number, pos: string, neg: string) =>
    `${Math.abs(n).toFixed(5)}° ${n >= 0 ? pos : neg}`;
  return `${f(latitude, 'N', 'S')}, ${f(longitude, 'E', 'W')}`;
}
