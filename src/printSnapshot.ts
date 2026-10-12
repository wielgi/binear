/**
 * Zrzut widoku do druku / PDF. Kopiujemy wezel widoku do niewidocznej ramki z tymi samymi arkuszami
 * stylow, wymuszamy jasny motyw i rozwijamy wszystkie sekcje (`<details>`), a potem wywolujemy druk ramki —
 * przegladarka oferuje „Zapisz jako PDF". Dzieki ramce nie musimy walczyc z ukladem aplikacji (przewijane
 * kontenery, ukryte paski), a widok na ekranie zostaje nietkniety.
 */
export function printSnapshot(source: HTMLElement, title: string): void {
  const clone = source.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''));
  clone.querySelectorAll('[data-no-print]').forEach((n) => n.remove());

  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')]
    .map((n) =>
      n instanceof HTMLLinkElement ? `<link rel="stylesheet" href="${n.href}">` : `<style>${n.textContent ?? ''}</style>`,
    )
    .join('\n');
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.srcdoc = `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><title>${esc(title)}</title>${styles}
<style>
  @page { margin: 12mm; }
  html, body { height: auto !important; overflow: visible !important; background: #fff; }
  .sum-scroll { overflow: visible !important; height: auto !important; }
  .sum-dept, .sum-tile { break-inside: avoid; }
</style></head><body>${clone.outerHTML}</body></html>`;
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return frame.remove();
    // Daj arkuszom i czcionkom chwile na zaladowanie, zanim ruszy druk.
    const go = () => {
      win.focus();
      win.addEventListener('afterprint', () => frame.remove());
      win.print();
    };
    const fonts = (win.document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    void (fonts ? fonts.ready : Promise.resolve()).then(() => setTimeout(go, 150));
  };
  document.body.appendChild(frame);
}
