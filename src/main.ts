// Front-end entry: load the precomputed JSON, then mount the FR-1…FR-5 views.
import "./styles/main.css";
import { loadData } from "./data";
import { throughputView } from "./views/throughput";
import { agingView } from "./views/aging";
import { backlogView } from "./views/backlog";
import { comparisonView } from "./views/comparison";
import { aboutView, stalenessBanner } from "./views/about";

const main = document.getElementById("main");
const header = document.getElementById("page-header");

async function mount(): Promise<void> {
  if (!main) return;
  try {
    const data = await loadData();

    const banner = stalenessBanner(data);
    if (banner && header) header.append(banner);

    main.replaceChildren(
      throughputView(data),
      agingView(data),
      backlogView(data),
      comparisonView(data),
      aboutView(data),
    );
  } catch (err) {
    main.replaceChildren(
      Object.assign(document.createElement("div"), {
        className: "banner error",
        textContent: `Failed to load dashboard data: ${(err as Error).message}. Run \`npm run ingest\` to generate public/data/.`,
      }),
    );
  }
}

void mount();
