const types = "feat|fix|perf|refactor|docs|test|build|ci|chore|revert|style";
const subjectPattern = new RegExp(`^(${types})(?:\\(([^()\\r\\n]+)\\))?(!)?: (\\S[^\\r\\n]*)$`);

export function parseSubject(subject) {
  if (/[\r\n]/.test(subject)) return null;
  const match = subjectPattern.exec(subject);
  if (!match) return null;
  return { type: match[1], scope: match[2], breaking: Boolean(match[3]), description: match[4] };
}

export function breakingNotes(body) {
  const lines = body.split("\n");
  const notes = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^BREAKING(?: CHANGE|-CHANGE):\s*(.*)$/.exec(lines[i]);
    if (!match) continue;
    const detail = [match[1]];
    while (i + 1 < lines.length && !/^[A-Za-z-]+(?:: | #)/.test(lines[i + 1])) {
      detail.push(lines[++i]);
    }
    notes.push(detail.join("\n").trim());
  }
  return notes;
}
