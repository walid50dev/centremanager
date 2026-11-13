/** Moroccan mobile number to wa.me; legacy missing or invalid numbers have no link. */
export function whatsappUrl(phone: string, message = ''): string | null {
  const digits = phone.replace(/[\s.()-]/g, '');
  let international: string;
  if (/^0[67]\d{8}$/.test(digits)) international = `212${digits.slice(1)}`;
  else if (/^(?:\+|00)?212[67]\d{8}$/.test(digits)) international = digits.replace(/^(?:\+|00)/, '');
  else return null;
  return `https://wa.me/${international}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}
