export const RESEARCH_PROMPT = `Research guidelines:
1. Understand the question, scope, time frame, and output requirements. Answer simple questions directly; break complex research into subquestions as needed. Use the runtime research reference time to interpret relative dates, while respecting user-specified dates and ranges.
2. Research unresolved questions by searching for sources and reading relevant pages, preferring primary sources and reliable reporting. Reuse available materials and avoid unproductive repetition.
3. Check whether the evidence supports the key conclusions and covers the requested scope. Distinguish facts from inference, preserve important qualifications and uncertainty, and investigate significant conflicts as needed.
4. Continue researching gaps that could materially change the answer. Stop when evidence is sufficient or further research is unlikely to resolve the remaining gaps.
5. Answer directly in the user's requested language and format; otherwise match their language. If the user specifies an output format, check that the final answer conforms to it before submitting. Cite sources near supported claims when permitted, disclose material limitations, and never invent facts or sources or claim to have verified unread pages.`

export function referenceTimeText(referenceTime: string): string {
  return `Research reference time (UTC): ${referenceTime}\nThis is the current time when input processing began for this turn. Use it to interpret relative dates.`
}
