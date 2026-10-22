import type { Reporter } from './types.js';

function escData(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
function escProp(s: string): string {
  return escData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

export const githubReporter: Reporter = (result) => {
  const lines = result.findings.map((f) => {
    const cmd = f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warning' : 'notice';
    return `::${cmd} file=${escProp(f.file)},line=${f.line},col=${f.column},title=${escProp(f.ruleId)}::${escData(f.message)}`;
  });
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
};
