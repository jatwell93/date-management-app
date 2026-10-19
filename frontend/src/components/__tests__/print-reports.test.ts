import fs from 'fs';
import path from 'path';

import { SHELL_MAIN_ID } from '../../layouts/shellMain';

const printCss = fs.readFileSync(path.resolve(__dirname, '../../theme/print-reports.css'), 'utf8');
const appSource = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

const ruleBody = (selectorPattern: RegExp) => {
  const match = printCss.match(
    new RegExp(`${selectorPattern.source}\\s*{([^}]*)}`, selectorPattern.flags),
  );
  return match?.[1] ?? '';
};

describe('print-reports stylesheet', () => {
  it('still keeps small sections on one printed page', () => {
    const body = ruleBody(/\n\s*section/);

    expect(body).toContain('page-break-inside: avoid !important');
    expect(body).toContain('break-inside: avoid !important');
  });

  it('lets page-root and report-body sections break across pages', () => {
    const body = ruleBody(
      /#main-content > section,\s*\[data-shell-route\] > section,\s*\.print-report-target,\s*section:has\(section, table\)/,
    );

    expect(body).toContain('page-break-inside: auto !important');
    expect(body).toContain('break-inside: auto !important');
  });

  it('targets the real shell main id and handheld route wrapper', () => {
    expect(SHELL_MAIN_ID).toBe('main-content');
    expect(printCss).toContain(`#${SHELL_MAIN_ID} > section`);
    expect(appSource).toMatch(/data-testid="handheld-route-shell"[^>]*data-shell-route/);
  });

  it('declares the page-root override after the generic section rule', () => {
    const generic = printCss.search(/\n\s*section\s*{/);
    const override = printCss.indexOf('#main-content > section');

    expect(generic).toBeGreaterThan(-1);
    expect(override).toBeGreaterThan(generic);
  });
});
