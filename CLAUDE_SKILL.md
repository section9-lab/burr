<!--
Licensed to the Apache Software Foundation (ASF) under one
or more contributor license agreements.  See the NOTICE file
distributed with this work for additional information
regarding copyright ownership.  The ASF licenses this file
to you under the Apache License, Version 2.0 (the
"License"); you may not use this file except in compliance
with the License.  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied.  See the License for the
specific language governing permissions and limitations
under the License.
-->

# Apache Burr Claude Code Skill

This repository includes a Claude Code skill that makes Claude an expert assistant for building Apache Burr applications.

## Quick Install

### Option 1: Install from GitHub (Easiest)

```bash
# Install to personal skills directory
claude skill install https://github.com/apache/burr/.claude/skills/burr

# Or install to project
cd your-project
claude skill install https://github.com/apache/burr/.claude/skills/burr --project
```

### Option 2: Manual Install

```bash
# Clone the repository
git clone https://github.com/apache/burr

# Install to personal skills directory
cp -r burr/.claude/skills/burr ~/.claude/skills/

# Or install to your project
cp -r burr/.claude/skills/burr .claude/skills/
```

## What You Get

Once installed, Claude becomes an expert in:

- **Building Burr applications** - Get help scaffolding state machines from scratch
- **Writing actions** - Create properly structured action functions with correct decorators
- **Defining transitions** - Set up conditional logic and state machine flows
- **Adding observability** - Configure the Burr UI and tracking
- **Debugging issues** - Troubleshoot common problems with state machines
- **Following best practices** - Learn recommended patterns and anti-patterns
- **Code review** - Get feedback on your Burr code

## Usage

### Automatic Activation

Just mention Burr in your conversation:

```
"Help me build a chatbot with Burr"
"Why isn't my state updating?"
"Show me how to add retry logic"
```

### Manual Invocation

Use the `/burr` command explicitly:

```
/burr How do I create a streaming action?
/burr Review this code for best practices
/burr Show me an example of parallel execution
```

## What's Included

The skill contains comprehensive documentation:

- **SKILL.md** - Main instructions for Claude
- **api-reference.md** - Complete Burr API documentation
- **examples.md** - Working code examples for common patterns
- **patterns.md** - Best practices and design patterns
- **troubleshooting.md** - Solutions to common issues
- **README.md** - Installation and usage guide

## Example Interactions

**Building a new application:**
```
You: "Help me create a Burr application for document processing"
Claude: I'll help you create a multi-stage pipeline...
[Generates complete application with actions and transitions]
```

**Getting examples:**
```
You: "Show me how to implement retry logic in Burr"
Claude: Here's a retry pattern with error recovery...
[Provides working code example]
```

**Debugging:**
```
You: "My state machine is looping infinitely"
Claude: Let me help you debug the transitions...
[Analyzes and suggests fixes]
```

**Code review:**
```
You: "Review this Burr code for best practices"
Claude: Let me check your application...
[Provides detailed feedback]
```

## Documentation

Full documentation available at:
- **Online**: https://burr.apache.org/getting_started/claude-skill
- **Local**: `docs/getting_started/claude-skill.rst` in this repository

## Requirements

- Claude Code CLI installed
- No Burr installation required (Claude can help you install when needed)

## Customization

You can customize the skill for your team:

1. Edit the files in `.claude/skills/burr/`
2. Add your own examples to `examples.md`
3. Update patterns in `patterns.md`
4. Extend the API reference

## Contributing

Found a bug or want to improve the skill?

- **Report issues**: https://github.com/apache/burr/issues
- **Submit fixes**: Open a pull request with your improvements
- **Suggest examples**: Share useful patterns you've discovered

We welcome contributions of all sizes - from typo fixes to new examples!

## Related Resources

- **Burr Documentation**: https://burr.apache.org
- **GitHub Repository**: https://github.com/apache/burr
- **Example Applications**: `examples/` directory
- **Discord Community**: https://discord.gg/6Zy2DwP4f3

## License

Apache License 2.0 - See LICENSE file in the root of the repository.

---

Built with ❤️ by the Apache Burr community.
