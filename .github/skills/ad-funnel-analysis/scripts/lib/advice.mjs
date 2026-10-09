// Recommendations backed twice: by this run's numbers (the finding's evidence) and by published platform guidance
// (best-practices.json), plus what the next report should show if the change worked.
const SEVERITY = { high: 3, medium: 2, low: 1, info: 0 };

export function practiceFor(bp, finding) {
  const id = typeof finding === 'string' ? finding : finding.id;
  const scoped = id.replace(/^(day|trend|today)-/, '');
  const key = bp.practices[id] ? id : bp.practices[scoped] ? scoped : id.startsWith('ab-') && finding.positive ? 'ab-winner' : 'default';
  const x = bp.practices[key];
  return {
    key,
    practice: x.practice,
    expect: x.expect,
    check: x.check,
    sources: (x.sources ?? []).map((s) => bp.sources[s]).filter((s) => s?.url),
  };
}

// One entry per change (listing every campaign it applies to), highest value and easiest first.
export function recommendations(m, bp, priority) {
  const groups = new Map();
  for (const f of m.findings.filter((x) => !x.positive && (x.severity !== 'info' || x.impact !== 'low'))) {
    const key = `${f.id}|${f.action}`;
    if (!groups.has(key)) groups.set(key, { ...f, campaigns: [], titles: [], evidences: [] });
    const g = groups.get(key);
    const label = f.campaign ? (m.campaigns.find((c) => c.key === f.campaign)?.label ?? f.campaign) : null;
    if (label) g.campaigns.push(label);
    g.titles.push(f.title);
    g.evidences.push({ campaign: label, text: f.evidence });
  }
  return [...groups.values()]
    .sort((a, b) => priority(b) - priority(a) || (SEVERITY[b.severity] ?? 0) - (SEVERITY[a.severity] ?? 0))
    .map((g) => ({
      ...g,
      evidence: g.evidences.map((e) => (g.evidences.length > 1 && e.campaign ? `${e.campaign}: ${e.text}` : e.text)).join('; '),
      basis: practiceFor(bp, g),
    }));
}

// Every source cited by the given recommendations, in first-cited order.
export function citedSources(recs) {
  const seen = new Map();
  for (const r of recs) for (const s of r.basis.sources) if (!seen.has(s.url)) seen.set(s.url, s);
  return [...seen.values()];
}
