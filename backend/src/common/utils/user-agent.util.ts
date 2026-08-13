export interface ParsedUserAgent {
  deviceType: 'mobile' | 'tablet' | 'desktop';
  deviceName: string;
  os: string;
  browser: string;
}

/**
 * Minimal, dependency-free User-Agent parser — good enough for session/device
 * tracking display purposes (not intended for bot detection or analytics-grade parsing).
 */
export function parseUserAgent(ua?: string): ParsedUserAgent {
  const value = ua || '';

  const isTablet = /ipad|tablet/i.test(value);
  const isMobile = !isTablet && /mobi|android|iphone/i.test(value);
  const deviceType: ParsedUserAgent['deviceType'] = isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop';

  let os = 'Unknown OS';
  if (/windows nt 10/i.test(value)) os = 'Windows 10/11';
  else if (/windows/i.test(value)) os = 'Windows';
  else if (/mac os x/i.test(value)) os = 'macOS';
  else if (/android/i.test(value)) os = 'Android';
  else if (/iphone|ipad|ios/i.test(value)) os = 'iOS';
  else if (/linux/i.test(value)) os = 'Linux';

  let browser = 'Unknown Browser';
  if (/edg\//i.test(value)) browser = 'Edge';
  else if (/chrome\//i.test(value) && !/chromium/i.test(value)) browser = 'Chrome';
  else if (/firefox\//i.test(value)) browser = 'Firefox';
  else if (/safari\//i.test(value) && !/chrome/i.test(value)) browser = 'Safari';
  else if (/opr\/|opera/i.test(value)) browser = 'Opera';

  const deviceName = `${browser} on ${os}`;

  return { deviceType, deviceName, os, browser };
}
