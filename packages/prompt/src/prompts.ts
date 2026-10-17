export const RESEARCH_PROMPT = ''

export function referenceTimeText(referenceTime: string): string {
  return `Research reference time (UTC): ${referenceTime}\nThis is the current time when input processing began for this turn. Use it to interpret relative dates.`
}
