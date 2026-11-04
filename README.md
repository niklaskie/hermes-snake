# Snake for Hermes Desktop

Snake as a page inside the [Hermes](https://github.com/NousResearch/hermes-agent) desktop app, with one live scoreboard for everyone who plays.

Scoreboard and install guide: **https://snake.niklaskietaibl.com**

## Install

**Easiest:** click **Open in Hermes** on https://snake.niklaskietaibl.com (or open `hermes://plugin/install?repo=niklaskie/hermes-snake`) and confirm the dialog in the desktop app.

**Or** send this to your Hermes:

> Install the Snake plugin for Hermes Desktop. Follow the steps at https://snake.niklaskietaibl.com/install.md exactly, and show me the SHA-256 check when you are done.

**Hermes runs on a server (desktop app connects over SSH):** in the desktop app open Capabilities → Plugins → **Install from Git** and paste:

```
https://github.com/niklaskie/hermes-snake
```

Then open **Snake** in the sidebar, or ⌘K → "Play Snake".

## What it does

`desktop/plugin.js` is the whole plugin. Read it, it is about 500 lines.

- Draws the game. Keeps your name and best score in the plugin's own storage.
- Sends `{name, score, run id}` to `https://snake.niklaskietaibl.com/api` and reads the scoreboard.
- Does not call Hermes (no sessions, files, tools or config) and loads no other code.

Desktop plugins run with the app's permissions, so do read the file before installing any plugin, this one included.

## Uninstall

Capabilities → Plugins, or delete the plugin folder in `~/.hermes/desktop-plugins/`.

## License

MIT
