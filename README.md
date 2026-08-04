# mcp-openagenda

OpenAgenda MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `search_agendas` | Find OpenAgenda agendas (event calendars) by keyword — e.g. a city, venue, festival or organisation name. Returns agenda uid + slug + title. Pass the uid to the events tool. Most agendas are French. |
| `events` | List events from one OpenAgenda agenda (get its uid from search_agendas). Defaults to upcoming events. Optionally filter by keyword and date window. Returns title, dates, venue, coordinates and keywords (English where available, else French). |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "openagenda": {
      "url": "https://gateway.pipeworx.io/openagenda/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Openagenda data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
