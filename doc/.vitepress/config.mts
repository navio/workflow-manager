import { defineConfig } from "vitepress";

export default defineConfig({
  base: "/workflow-manager/",
  title: "workflow-manager",
  description: "CLI runner for markdown + in-memory workflow orchestration",
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "News", link: "/news/" },
      { text: "Install", link: "/guide/installing" },
      { text: "Getting Started", link: "/guide/getting-started" },
      { text: "How It Works", link: "/guide/how-it-works" },
      { text: "Architecture", link: "/guide/architecture" },
      { text: "Runner API", link: "/guide/runner-api" },
      { text: "Terminal UI", link: "/guide/terminal-ui" },
      { text: "Authoring With an Agent", link: "/guide/authoring-with-an-agent" },
      { text: "Remote Registry", link: "/remote-registry/" },
      { text: "Workflow Manager UI", link: "https://workflow-manager-ui.netlify.app" },
      { text: "ERD", link: "/guide/erd" },
      { text: "Protocol", link: "/guide/protocol" },
      { text: "Workflow Schema", link: "/guide/workflow-schema" },
      { text: "Workflow Examples", link: "/guide/workflow-examples" }
    ],
    sidebar: [
      {
        text: "News",
        items: [
          { text: "All posts", link: "/news/" },
          { text: "Agent-Authored Workflows (v0.8.0)", link: "/news/2026-07-13-agent-authored-workflows" }
        ]
      },
      {
        text: "Guide",
        items: [
          { text: "Installing the CLI", link: "/guide/installing" },
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "How It Works", link: "/guide/how-it-works" },
          { text: "Architecture", link: "/guide/architecture" },
          { text: "Runner API", link: "/guide/runner-api" },
          { text: "Terminal UI", link: "/guide/terminal-ui" },
          { text: "Authoring With an Agent", link: "/guide/authoring-with-an-agent" },
          { text: "ERD", link: "/guide/erd" },
          { text: "Protocol", link: "/guide/protocol" },
          { text: "Workflow Schema", link: "/guide/workflow-schema" },
          { text: "Workflow Examples", link: "/guide/workflow-examples" }
        ]
      },
      {
        text: "Remote Registry",
        items: [
          { text: "Architecture", link: "/remote-registry/" },
          { text: "Agent Team", link: "/remote-registry/agents" },
          { text: "Tasks", link: "/remote-registry/tasks" }
        ]
      }
    ]
  }
});
