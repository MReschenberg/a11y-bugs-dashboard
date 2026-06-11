// Accessible table helpers. Every chart ships an associated data table — the real
// screen-reader experience (Observable Plot's SVG is not accessible by default).
// Tables are always in the DOM (so SR users get them); a button toggles visual
// display for sighted users.

export type Cell = string | number;

export function buildTable(caption: string, headers: string[], rows: Cell[][]): HTMLTableElement {
  const table = document.createElement("table");

  const cap = document.createElement("caption");
  cap.textContent = caption;
  table.append(cap);

  const thead = document.createElement("thead");
  const htr = document.createElement("tr");
  for (const h of headers) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = h;
    htr.append(th);
  }
  thead.append(htr);
  table.append(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    row.forEach((value, i) => {
      const cell = document.createElement(i === 0 ? "th" : "td");
      if (i === 0) (cell as HTMLTableCellElement).scope = "row";
      cell.textContent = String(value);
      tr.append(cell);
    });
    tbody.append(tr);
  }
  table.append(tbody);
  return table;
}

let toggleSeq = 0;

/** A button that shows/hides an associated (visually-hidden by default) table. */
export function tableToggle(table: HTMLTableElement, label = "data table"): HTMLButtonElement {
  table.classList.add("visually-hidden");
  if (!table.id) table.id = `data-table-${++toggleSeq}`;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "table-toggle";
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", table.id);
  btn.textContent = `View ${label}`;
  btn.addEventListener("click", () => {
    const nowVisible = table.classList.toggle("visually-hidden") === false;
    btn.setAttribute("aria-expanded", String(nowVisible));
    btn.textContent = nowVisible ? `Hide ${label}` : `View ${label}`;
  });
  return btn;
}
