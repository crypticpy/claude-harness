/**
 * Distillation threshold gate (pure).
 *
 * Decides whether a PreCompact should escalate from the deterministic checkpoint
 * to an LLM distillation pass. Routine sessions stay LLM-free; distillation only
 * fires when the session shows signal worth distilling (docs/05).
 *
 * Thresholds come from puntax.precompact.thresholds; `force` covers the explicit
 * /evolve and /retrospective requests.
 */

/**
 * @param {object} metrics  { toolErrors, retryPatterns, explorationSpirals,
 *                            changedFiles, permissionDenials, highRisk }
 * @param {object} thresholds { toolErrors, retryPatterns, explorationSpirals, changedFiles }
 * @param {object} [opts] { force?: boolean }
 * @returns {{ trigger: boolean, reasons: string[] }}
 */
export function evaluateThresholds(metrics = {}, thresholds = {}, opts = {}) {
  const reasons = [];
  const m = {
    toolErrors: num(metrics.toolErrors),
    retryPatterns: num(metrics.retryPatterns),
    explorationSpirals: num(metrics.explorationSpirals),
    changedFiles: num(metrics.changedFiles),
    permissionDenials: num(metrics.permissionDenials),
    highRisk: Boolean(metrics.highRisk),
  };
  const t = {
    toolErrors: num(thresholds.toolErrors, 3),
    retryPatterns: num(thresholds.retryPatterns, 2),
    explorationSpirals: num(thresholds.explorationSpirals, 1),
    changedFiles: num(thresholds.changedFiles, 6),
  };

  if (opts.force) reasons.push('explicit-request');
  if (m.highRisk) reasons.push('high-severity-error');
  if (m.permissionDenials >= 2) reasons.push('repeated-permission-denial');
  if (m.toolErrors >= t.toolErrors) reasons.push(`toolErrors>=${t.toolErrors}`);
  if (m.retryPatterns >= t.retryPatterns) reasons.push(`retryPatterns>=${t.retryPatterns}`);
  if (m.explorationSpirals >= t.explorationSpirals) {
    reasons.push(`explorationSpirals>=${t.explorationSpirals}`);
  }
  if (m.changedFiles >= t.changedFiles) reasons.push(`changedFiles>=${t.changedFiles}`);

  return { trigger: reasons.length > 0, reasons };
}

/** Build the metrics object from a deterministic checkpoint + transcript signals. */
export function buildMetrics(checkpoint = {}, signals = {}) {
  const cp = checkpoint || {};
  const sg = signals || {};
  return {
    toolErrors: num(sg.toolErrors),
    retryPatterns: num(sg.retryPatterns),
    explorationSpirals: num(sg.explorationSpirals),
    changedFiles: Array.isArray(cp.changedFiles) ? cp.changedFiles.length : 0,
    permissionDenials: Array.isArray(cp.permissionDenials)
      ? cp.permissionDenials.length
      : num(sg.permissionDenials),
    highRisk:
      cp.risk === 'high' ||
      cp.risk === 'critical' ||
      (Array.isArray(cp.failures) && cp.failures.length >= 3),
  };
}

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
