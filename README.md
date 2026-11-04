# DaedalusIDE

> **Distraction-free AI engineering in the browser.** A minimalist, local-first code workspace powered by a BYOK (Bring-Your-Own-Key) tiered model architecture and an isolated client-side execution loop.

## Overview

**DaedalusIDE** is a lightweight, browser-based development environment engineered for focused, cost-optimized software craft. Built on top of **CodeMirror 6**, **React**, and the **File System Access API**, it delivers a local-first workspace with zero server overhead.

Instead of running autonomous AI agents that burn through API budgets, DaedalusIDE uses a structured **Plan \\rightarrow Review \\rightarrow Execute** workflow. High-context models map out architectural blueprints, which you review visually before running execution tasks through cheap or local models (e.g., Ollama or Gemini Flash).

## Core Architecture

DaedalusIDE runs 100% client-side as a static Single Page Application (SPA), requiring no backend servers or intermediate proxy layers.

```mermaid
%%{init: {
  'theme': 'base',
  'themeVariables': {
    'primaryColor': '#ffffff',
    'primaryTextColor': '#0f172a',
    'primaryBorderColor': '#e2e8f0',
    'lineColor': '#64748b',
    'secondaryColor': '#fafafa',
    'tertiaryColor': '#f8fafc',
    'fontFamily': 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    'fontSize': '12px'
  }
}}%%
graph TD
    subgraph Browser ["Client Application · Static SPA"]
        UI["Editor UI<br/><i>React · CodeMirror 6</i>"]
        State["App State<br/><i>Jotai Atoms</i>"]
        
        subgraph Storage ["Local Storage"]
            FS["Workspace FS<br/><i>Linked folder</i>"]
            IDB["Settings & Sessions<br/><i>IndexedDB</i>"]
        end
        
        subgraph Engine ["Execution Engine"]
            Pipeline["Workflow Pipeline<br/><i>Plan · Review · Execute</i>"]
            Router["Model Router<br/><i>Provider Adapters</i>"]
            Vault["Key Vault<br/><i>PBKDF2 → AES-GCM</i>"]
        end

        UI <--> State
        State <--> FS
        State <--> IDB
        State <--> Pipeline
        Pipeline --> Router
        Router --> Vault
    end

    subgraph Providers ["LLM Endpoints"]
        Gemini["Google Gemini"]
        Anthropic["Anthropic Claude"]
        Ollama["Local Ollama"]
    end

    Router -.->|"HTTPS · SSE"| Gemini
    Router -.->|"HTTPS · SSE"| Anthropic
    Router -.->|"HTTP · NDJSON"| Ollama

    classDef default fill:#ffffff,stroke:#e2e8f0,stroke-width:1px,color:#0f172a,rx:6px,ry:6px;
    classDef browserGroup fill:#ffffff,stroke:#cbd5e1,stroke-width:1px,color:#475569;
    classDef innerGroup fill:#f8fafc,stroke:#e2e8f0,stroke-width:1px,color:#64748b;
    classDef providerGroup fill:#ffffff,stroke:#cbd5e1,stroke-width:1px,color:#475569;

    class Browser browserGroup;
    class Storage,Engine innerGroup;
    class Providers providerGroup;
```

## Key Features

- **Distraction-Free Workspace:** Minimal, typography-first interface built for focused code editing and planning.
- **BYOK Key Management:** Provider keys (Anthropic, Google Gemini, OpenCode, Ollama) stay encrypted on your device using native Web Crypto (`AES-GCM` + `PBKDF2`).
- **Cost-Optimized Tiered Pipeline:**
  - **Plan:** Generate implementation blueprints using high-reasoning models (Gemini Flash, Claude 3.5 Sonnet, DeepSeek).
  - **Review:** Visually inspect diffs, logic breakdowns, and file operations before executing code modifications.
  - **Execute:** Apply changes using zero-cost local LLMs (`Ollama`) or low-cost cloud models.
- **Linked Folders:** Edit files in place in a folder you pick; nothing is copied.
- **Zero Backend Dependency:** Static asset hosting via Netlify CDN; network calls go straight from client to provider APIs.

## Getting Started

### Prerequisites

- **Node.js:** `>=18.0.0`
- **Package Manager:** `npm` or `pnpm`

### Installation

1. **Clone the repository:**

   ```
   git clone https://github.com/your-username/daedalus-ide.git
   cd daedalus-ide
   ```

2. **Install dependencies:**

   ```
   npm install
   ```

3. **Start the local development server:**

   ```
   npm run dev
   ```

4. Open your browser and navigate to `http://localhost:517

## Tech Stack

- **UI & Framework:** React, Tailwind CSS
- **Editor Core:** CodeMirror 6
- **State Management:** Jotai
- **Storage:** File System Access API (linked folder), IndexedDB for metadata
- **Security:** Web Crypto API (`SubtleCrypto`)
- **Hosting:** Netlify CDN

## License

MIT © [Mares Popa](https://marespopa.com)