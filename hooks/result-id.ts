// Every finished game gets an id. A board re-sends its last result with each
// later save, because a later post in the same frame replaces an earlier one;
// the pane counts each id once, so a resend is never counted twice.
export const resultId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
