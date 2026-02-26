# Sails AI Skills for Claude Code

Build AI-powered features in Sails.js just by prompting Claude Code.

## Installation

```bash
npx skills add sailscastshq/sails-ai/skills
```

## Usage

After installing, just ask Claude to add AI features:

> "Add a chat endpoint that streams AI responses over WebSocket"

> "Set up Ollama as my local AI provider"

> "Create an adapter for Anthropic's API"

## Skills Included

- **getting-started** - Install sails-ai, configure a provider, send your first chat
- **configuration** - Multi-provider setup, environment-based switching, model mapping
- **chat** - Chat completions with flexible input formats
- **streaming** - Real-time streaming via async generators
- **adapters** - Build custom adapters for any AI provider
- **patterns** - Credits systems, conversation persistence, error handling

## What is Sails AI?

Sails AI is a multi-provider AI hook for [Sails.js](https://sailsjs.com). It uses an adapter pattern (similar to Sails Pay) so you can swap AI providers without changing application code.

## Links

- [Official Docs](https://docs.sailscasts.com/sails-ai/)
- [GitHub](https://github.com/sailscastshq/sails-ai)

## License

MIT
