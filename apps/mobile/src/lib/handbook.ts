export type Block = { type: 'h' | 'p' | 'li'; text: string };

/**
 * Handbook text is plain text with three simple marks: "## Heading", "- bullet" and blank-line separated
 * paragraphs. Nothing is interpreted as HTML or links, so company-written text cannot run anything.
 */
export function parseHandbook(body: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ type: 'p', text: para.join(' ') });
    para = [];
  };
  for (const raw of body.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) flush();
    else if (/^#{1,3}\s+/.test(line)) {
      flush();
      out.push({ type: 'h', text: line.replace(/^#{1,3}\s+/, '') });
    } else if (/^[-*•]\s+/.test(line)) {
      flush();
      out.push({ type: 'li', text: line.replace(/^[-*•]\s+/, '') });
    } else para.push(line);
  }
  flush();
  return out;
}
