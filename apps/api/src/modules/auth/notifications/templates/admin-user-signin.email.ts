export interface AdminSigninVars {
  userEmail: string;
  novaTag: string | null;
  deviceName: string;
  os: string;
  browser: string;
  ip: string;
  city?: string;
  region?: string;
  country?: string;
  at: Date;
}

export function buildAdminUserSigninEmail(v: AdminSigninVars) {
  const loc = [v.city, v.region, v.country].filter(Boolean).join(', ') || 'unknown';
  const subject = `[admin] user sign-in: ${v.userEmail}`;
  const text = [
    `User sign-in event.`,
    ``,
    `User:     ${v.userEmail}${v.novaTag ? ` (${v.novaTag})` : ''}`,
    `Device:   ${v.deviceName}`,
    `OS:       ${v.os}`,
    `Browser:  ${v.browser}`,
    `IP:       ${v.ip}`,
    `Location: ${loc}`,
    `When:     ${v.at.toISOString()}`,
  ].join('\n');
  return { subject, text };
}
