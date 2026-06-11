// Render a string with minimal inline markdown into a DocumentFragment:
//   `code` → <code>, _em_ → <em>. Everything else is plain text.
// Used so prose can mention the `access` keyword (etc.) with real code styling
// instead of literal backticks.
export function frag(text: string): DocumentFragment {
  const f = document.createDocumentFragment();
  const re = /`([^`]+)`|_([^_]+)_/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) f.append(text.slice(last, m.index));
    const node = document.createElement(m[1] !== undefined ? "code" : "em");
    node.textContent = m[1] !== undefined ? m[1] : m[2];
    f.append(node);
    last = re.lastIndex;
  }
  if (last < text.length) f.append(text.slice(last));
  return f;
}
