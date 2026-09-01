export interface AdminUserSignupVars {
  userEmail: string;
  phoneE164: string | null;
  fullName: string;
  dob: Date | null;
  address: { street?: string | null; apt?: string | null; city?: string | null; state?: string | null; zip?: string | null };
  ssnLast4: string;
  verifiedChannel: string | null;
  ip: string;
  city?: string;
  region?: string;
  country?: string;
  at: Date;
}

export function buildAdminUserSignupEmail(v: AdminUserSignupVars) {
  const loc = [v.city, v.region, v.country].filter(Boolean).join(', ') || 'unknown';
  const addr = [
    [v.address.street, v.address.apt].filter(Boolean).join(' '),
    [v.address.city, v.address.state, v.address.zip].filter(Boolean).join(', '),
  ].filter(Boolean).join(' / ');

  const subject = `[admin] new signup completed: ${v.userEmail}`;
  const text = [
    `A new user has completed signup.`,
    ``,
    `Name:        ${v.fullName}`,
    `Email:       ${v.userEmail}`,
    `Phone:       ${v.phoneE164 ?? '-'}`,
    `DOB:         ${v.dob ? v.dob.toISOString().slice(0, 10) : '-'}`,
    `Address:     ${addr || '-'}`,
    `SSN (last4): ${v.ssnLast4}`,
    `Verified via: ${v.verifiedChannel ?? '-'}`,
    `Signup IP:   ${v.ip}`,
    `Location:    ${loc}`,
    `When:        ${v.at.toISOString()}`,
    ``,
    `KYC documents are attached for review.`,
  ].join('\n');
  return { subject, text };
}
