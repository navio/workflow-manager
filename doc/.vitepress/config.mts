import { defineConfig } from "vitepress";

export default defineConfig({
  title: "workflow-manager",
  description: "CLI runner for markdown + in-memory workflow orchestration",
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "Getting Started", link: "/guide/getting-started" },
      { text: "How It Works", link: "/guide/how-it-works" },
      { text: "Architecture", link: "/guide/architecture" },
      { text: "ERD", link: "/guide/erd" },
      { text: "Protocol", link: "/guide/protocol" },
      { text: "Workflow Schema", link: "/guide/workflow-schema" },
      { text: "Workflow Examples", link: "/guide/workflow-examples" }
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "How It Works", link: "/guide/how-it-works" },
          { text: "Architecture", link: "/guide/architecture" },
          { text: "ERD", link: "/guide/erd" },
          { text: "Protocol", link: "/guide/protocol" },
          { text: "Workflow Schema", link: "/guide/workflow-schema" },
          { text: "Workflow Examples", link: "/guide/workflow-examples" }
        ]
      }
    ]
  }
});
