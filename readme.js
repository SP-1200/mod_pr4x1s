// README.txt for the download zip. The Warning and Usage text comes from the
// page itself (#warning, #usage), so the two can't drift apart.

const WIDTH = 72;

function wrap(text, indent = '', first = indent) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = first;
  for (const w of words) {
    if (line.trim() && (line + w).length > WIDTH) { lines.push(line.trimEnd()); line = indent; }
    line += w + ' ';
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.join('\n');
}

// Inline text: screen messages in quotes, decorative icons dropped.
function inline(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE || node.getAttribute('aria-hidden') === 'true') return '';
  const text = [...node.childNodes].map(inline).join('');
  return node.classList.contains('screen') ? `"${text}"` : text;
}

function blocks(el, out) {
  for (const node of el.children) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'h2') { const t = inline(node).trim().toUpperCase(); out.push(`${t}\n${'='.repeat(t.length)}`); }
    else if (tag === 'h3') { const t = inline(node).trim(); out.push(`${t}\n${'-'.repeat(t.length)}`); }
    else if (tag === 'p') out.push(wrap(inline(node)));
    else if (tag === 'ul') out.push([...node.children].map(li => wrap(inline(li), '  ', '- ')).join('\n'));
    else if (tag === 'ol') out.push([...node.children].map((li, i) => wrap(inline(li), '   ', `${i + 1}. `)).join('\n'));
    else if (tag === 'dl') {
      const items = [];
      for (const n of node.querySelectorAll('dt, dd'))
        // The red box on the page (.danger) becomes a WARNING: prefix here.
        items.push(n.tagName === 'DT' ? wrap((n.closest('.danger') ? 'WARNING: ' : '') + inline(n).trim())
          : wrap(inline(n), '    ') + '\n');
      out.push(items.join('\n').trimEnd());
    } else blocks(node, out);
  }
}

export function readmeText({ recipe, outMd5, pageUrl, date = new Date() }) {
  const title = `mod_pr4x1s (${recipe.version})`;
  const out = [
    `${title}\n${'='.repeat(title.length)}`,
    wrap(`Built ${date.toISOString().slice(0, 10)} from Rossum's ${recipe.stockName} at ${pageUrl}`),
    `sp1200eefw.bin MD5: ${outMd5}\n` +
      wrap('To check it: "md5 sp1200eefw.bin" on a Mac, "certutil -hashfile sp1200eefw.bin MD5" on Windows.'),
    wrap('COPY ONLY sp1200eefw.bin TO THE TOP LEVEL OF YOUR SD CARD. Not this README, and not the zip.'),
    wrap(`PLEASE DON'T SHARE sp1200eefw.bin: it contains Rossum's firmware. ` +
      `Anyone who wants mod_pr4x1s can build their own from Rossum's download at ${pageUrl}`),
  ];
  for (const id of ['warning', 'usage']) blocks(document.getElementById(id), out);
  // CRLF and, if there's anything beyond ASCII, a UTF-8 BOM: Notepad before
  // Windows 10 1809 shows LF-only files as one line and reads BOM-less files as ANSI.
  const text = (out.join('\n\n') + '\n').replace(/\n/g, '\r\n');
  return /[^\x00-\x7f]/.test(text) ? '﻿' + text : text;
}
