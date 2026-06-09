# Creative Automation

Creative Automation is a Chrome extension side panel for automating NotebookLM-powered product research workflows. It connects NotebookLM notebooks, Amazon Search compare data, Gemini actions, and ChatGPT handoff into one compact browser workspace.

The extension is designed for repeated operational work: select or create a NotebookLM notebook, upload sources, ask questions, import Amazon listing comparisons, generate structured follow-up outputs, and send product-description prompts without leaving the side panel.

## Features

- **NotebookLM workspace**
  - List, select, create, and rename notebooks.
  - Add URL sources and upload files.
  - Ask notebook questions from the side panel.
  - Clear saved local automation history without deleting NotebookLM chat.
- **Amazon Search workflow**
  - Reads Compare Listings data from `https://amazon-crawler.netlify.app/`.
  - Creates a NotebookLM notebook from selected listings.
  - Uploads listing metadata, PDFs, images, and product data.
  - Runs an initial NotebookLM analysis when upload completes.
- **Response actions**
  - Edit and copy generated responses.
  - Generate Bullet Points and Image Prompt outputs from NotebookLM analysis.
  - Send Bullet Points output to ChatGPT as Product Description.
- **Focused side-panel UI**
  - No popup surface; clicking the extension action opens the side panel.
  - Light Creative Automation theme with compact controls, skeleton loading states, and operational spacing.

## Requirements

- Google Chrome or another Chromium browser with Manifest V3 extension support.
- A signed-in Google account with access to NotebookLM.
- Access to:
  - `https://notebooklm.google.com/`
  - `https://amazon-crawler.netlify.app/`
  - `https://gemini.google.com/`
  - `https://chatgpt.com/`

## Installation

### Download

Download and extract the latest ZIP:

[Download Creative Automation](https://github.com/ptrgiang/creative-automation/archive/refs/heads/main.zip)

Then load the extension:

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select:

Your extracted `CreativeAutomation` folder.

5. Click the Creative Automation toolbar icon to open the side panel.

If NotebookLM requests login, open NotebookLM in a normal browser tab, sign in, then retry from the side panel.

## Update

Windows users can update with one click:

1. Double-click `update.exe` inside the extension folder.
2. Wait for the update to finish.
3. Open `chrome://extensions`.
4. Click the reload icon for Creative Automation.

The updater downloads the latest GitHub ZIP, saves a backup in your Windows temp folder, mirrors updated files, and keeps `update.exe` in place.

## Workflow

### 1. Prepare NotebookLM

1. Open the side panel.
2. Select an existing notebook, or click `+` to create one inline.
3. Use the Sources tab to add a URL or upload a supported file.
4. Switch back to Chat and ask the notebook a question.

### 2. Import Amazon Search comparisons

1. Open [Amazon Search](https://amazon-crawler.netlify.app/).
2. Open Compare Listings and select products.
3. Return to the Creative Automation side panel.
4. Confirm the Amazon Search section shows the product count.
5. Click **Upload Listings to NotebookLM**.
6. Wait for upload progress to complete.
7. Review the generated NotebookLM analysis in Chat.

When Compare Listings is closed and the Amazon Search page clears its local selection, the side panel returns to **Open Compare Listings**.

### 3. Generate follow-up outputs

After a NotebookLM analysis appears:

1. Use the **Bullet Points** icon button to generate structured bullet-point output.
2. Use the **Image Prompt** icon button to generate image prompt content.
3. Use the combined workflow icon button to run **Bullet Points → Image Prompt → Product Description** in sequence.
4. Use the **Product Description** icon button under any Bullet Points response to send that response to ChatGPT.
5. Use the edit icon to adjust any generated response inline.
6. Use the copy icon to copy a response.

Saved local automation history is attached to the selected notebook and reloads after the NotebookLM chat conversation.

## Permissions

The extension requests:

- `sidePanel` to run as a Chrome side panel.
- `tabs` and `scripting` to read Amazon Search compare data and interact with Gemini/ChatGPT tabs.
- `cookies` and `storage` to support NotebookLM authentication/session workflows.
- Host access for NotebookLM, Google/Gemini, Amazon Search, Amazon image/API domains, and ChatGPT.

## Project Structure

- `manifest.json` - Chrome extension manifest.
- `background.js` - NotebookLM RPC calls, uploads, Gemini/ChatGPT handoff, and background job handling.
- `sidepanel.html` - Main side panel UI.
- `sidepanel.css` - Creative Automation side panel theme and states.
- `sidepanel.js` - Side panel interactions and Chrome runtime messaging.
- `content-amazon.js` - Amazon Search compare-state bridge.
- `icons/` - Extension icon PNG assets.
- `generate-icons.html` - Local icon regeneration helper.
- `update.exe` - one-click Windows updater.
- `update.cs` - source code for the Windows updater.

## Manual QA Before Publishing

- Load the extension unpacked in Chrome.
- Confirm the toolbar action opens the side panel.
- Confirm there is no popup UI.
- Sign in to NotebookLM and load notebooks.
- Create and rename a notebook inline.
- Add URL and file sources.
- Ask a notebook question and verify response edit/copy actions.
- Open Amazon Search, open Compare Listings, and verify product count appears.
- Close Compare Listings and verify the side panel returns to **Open Compare Listings**.
- Upload listings to NotebookLM and verify progress, notebook selection, and analysis output.
- Generate Bullet Points, Image Prompt, and Product Desc.

## Publish Checklist

- Verify `manifest.json` name, description, version, permissions, and host permissions.
- Confirm `icons/icon16.png`, `icons/icon48.png`, and `icons/icon128.png` are current.
- Run syntax checks:

```powershell
node --check background.js
node --check sidepanel.js
node --check content-amazon.js
```

- Run Git whitespace checks:

```powershell
git diff --check
```

- Zip the repository contents, excluding `.git` and local-only artifacts.
- Submit the packaged extension through the Chrome Web Store developer dashboard.

## Notes

- This extension depends on NotebookLM web APIs and browser-session access. If NotebookLM changes its internal RPC surface, background calls may need maintenance.
- The popup files were removed intentionally. The extension uses only the side panel.
