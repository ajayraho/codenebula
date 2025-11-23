# CodeNebula

**CodeNebula** is a beautiful, interactive visualization tool that turns your codebase into a galaxy of interconnected nodes.

## Features

- **Interactive Graph**: Zoom, pan, and explore your file structure.
- **Smart Grouping**: Files are grouped by folders.
- **Reference Tracking**:
  - **Node Size**: Represents how many times a file is referenced.
  - **Edge Thickness**: Represents the strength of the connection (number of imports).
- **Multi-Language Support**: Powered by `web-tree-sitter` (Coming Soon).
- **Modern UI**: Built with Next.js, Tailwind CSS, and Lucide Icons.

## Getting Started

1.  **Install dependencies**:
    ```bash
    npm install
    ```

2.  **Run the development server**:
    ```bash
    npm run dev
    ```

3.  Open [http://localhost:3000](http://localhost:3000) with your browser.

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Styling**: Tailwind CSS
- **Visualization**: `react-force-graph-2d`
- **Parsing**: `web-tree-sitter`

## Author

Ajit K.
