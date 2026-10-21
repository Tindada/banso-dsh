/** Only the selection lives in the URL; preserve authentication and other parameters. */
export function sessionFromUrl(href: string): string | undefined {
  return new URL(href).searchParams.get('session') || undefined;
}
export function urlForSession(href: string, id?: string): string {
  const url = new URL(href);
  if (id) url.searchParams.set('session', id);
  else url.searchParams.delete('session');
  return url.href;
}
export function titleFromQuestion(text: string): string {
  const chars = [...text.replace(/\s+/gu, ' ').trim()];
  return chars.slice(0, 30).join('') + (chars.length > 30 ? '…' : '');
}

/** Compact list label; keep the exact timestamp in the element's tooltip. */
export function relativeSessionTime(timestamp: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天`;
  const date = new Date(timestamp);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}
