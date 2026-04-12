import { defineConfig } from "vitepress";

export default defineConfig({
  title: "workflow-manager",
  description: "CLI runner for markdown + in-memory workflow orchestration",
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "Getting Started", link: "/guide/getting-started" },
      { text: "Workflow Schema", link: "/guide/workflow-schema" }
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "Workflow Schema", link: "/guide/workflow-schema" }
        ]
      }
    ]
  }
});
