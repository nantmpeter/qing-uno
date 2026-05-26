#!/usr/bin/env node

/**
 * AI Writing Assistant for qing.uno blog
 *
 * Usage:
 *   node scripts/ai-writer.mjs outline "Building Multi-Agent Systems"
 *   node scripts/ai-writer.mjs polish src/content/blog/my-draft.md
 *   node scripts/ai-writer.mjs translate src/content/blog/my-post.md
 *   node scripts/ai-writer.mjs new "My Post Title"
 *
 * Environment:
 *   OPENAI_API_KEY or OPENAI_BASE_URL + OPENAI_API_KEY (for compatible APIs)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = path.join(__dirname, '..', 'src', 'content', 'blog');

// --- LLM call helper ---
async function callLLM(messages, options = {}) {
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';

  if (!apiKey) {
    console.error('Error: OPENAI_API_KEY environment variable is required');
    process.exit(1);
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2000,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`LLM API error (${response.status}): ${err}`);
    process.exit(1);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// --- Generate outline ---
async function generateOutline(topic) {
  console.log(`\nGenerating outline for: "${topic}"...\n`);

  const messages = [
    {
      role: 'system',
      content: `You are an expert technical blog writer. You write in a clear, concise style.
The blog is "qing.uno" — focused on AI, software engineering, and creative technology.
The author is a developer who builds real things: multi-agent systems, game AI pipelines, full-stack apps.

Generate a detailed blog post outline in Markdown format. Include:
- A compelling title
- A 1-2 sentence description
- Main sections with sub-points
- Suggestions for code examples or diagrams
- Tags (3-5 relevant tags)

Write the outline in the same language as the topic. If the topic is in Chinese, write in Chinese. If English, write in English.`
    },
    {
      role: 'user',
      content: `Generate a detailed blog post outline for: "${topic}"`
    }
  ];

  const outline = await callLLM(messages);
  console.log(outline);
  return outline;
}

// --- Polish draft ---
async function polishDraft(filePath) {
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  console.log(`\nPolishing: ${path.basename(fullPath)}...\n`);

  const messages = [
    {
      role: 'system',
      content: `You are a skilled technical editor. Polish the following blog post draft while:
- Preserving the author's voice and technical accuracy
- Improving clarity, flow, and readability
- Fixing grammar and typos
- Ensuring good transitions between sections
- Keeping the same Markdown structure (headings, code blocks, etc.)
- NOT changing the frontmatter (between --- markers)

Output ONLY the polished version of the full post including unchanged frontmatter.`
    },
    {
      role: 'user',
      content: content
    }
  ];

  const polished = await callLLM(messages, { maxTokens: 4000 });

  // Backup original
  const backupPath = fullPath.replace('.md', '.original.md');
  fs.writeFileSync(backupPath, content, 'utf-8');
  console.log(`Original backed up to: ${path.basename(backupPath)}`);

  // Write polished version
  fs.writeFileSync(fullPath, polished, 'utf-8');
  console.log(`Polished version saved to: ${path.basename(fullPath)}`);
  console.log(`\n--- Preview (first 500 chars) ---\n`);
  console.log(polished.substring(0, 500) + '...\n');
}

// --- Translate post ---
async function translatePost(filePath) {
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(fullPath, 'utf-8');

  // Detect source language
  const langMatch = content.match(/lang:\s*['"]?(zh|en)['"]?/);
  const sourceLang = langMatch ? langMatch[1] : 'zh';
  const targetLang = sourceLang === 'zh' ? 'en' : 'zh';

  console.log(`\nTranslating: ${path.basename(fullPath)} (${sourceLang} → ${targetLang})...\n`);

  const messages = [
    {
      role: 'system',
      content: `You are a professional translator for technical blog content.
Translate the following blog post from ${sourceLang === 'zh' ? 'Chinese' : 'English'} to ${targetLang === 'zh' ? 'Chinese' : 'English'}.

Rules:
- Translate ALL text content but keep code blocks, variable names, and technical terms untranslated
- Keep the frontmatter structure, but translate title and description
- Update the "lang" field to "${targetLang}"
- Keep tags as-is
- Maintain the same Markdown formatting
- Make the translation sound natural, not like a machine translation

Output ONLY the translated full post.`
    },
    {
      role: 'user',
      content: content
    }
  ];

  const translated = await callLLM(messages, { maxTokens: 4000 });

  // Determine output path
  const dir = path.dirname(fullPath);
  const ext = path.extname(fullPath);
  const baseName = path.basename(fullPath, ext);
  const suffix = targetLang === 'en' ? '-en' : '';
  const outputPath = path.join(dir, `${baseName}${suffix}${ext}`);

  fs.writeFileSync(outputPath, translated, 'utf-8');
  console.log(`Translated version saved to: ${path.basename(outputPath)}`);
}

// --- Create new post scaffold ---
async function newPost(title) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '');

  const today = new Date().toISOString().split('T')[0];

  // Generate AI suggestions
  console.log(`\nGenerating content suggestions for: "${title}"...\n`);

  const messages = [
    {
      role: 'system',
      content: `You are a blog content strategist. Given a blog post title, generate:
1. A compelling meta description (under 160 characters)
2. 3-5 relevant tags
3. A brief TL;DR summary (2-3 sentences)

Return as JSON: { "description": "...", "tags": [...], "tldr": "..." }`
    },
    {
      role: 'user',
      content: `Title: "${title}"`
    }
  ];

  let meta;
  try {
    const result = await callLLM(messages, { temperature: 0.5 });
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    meta = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch {
    meta = { description: '', tags: [], tldr: '' };
  }

  const frontmatter = `---
title: '${title}'
description: '${meta.description || 'TODO: Add description'}'
pubDate: ${today}
tags: [${(meta.tags || ['todo']).map(t => `'${t}'`).join(', ')}]
category: ''
lang: 'zh'
tldr: '${meta.tldr || ''}'
---

# ${title}

> ${meta.tldr || 'TL;DR placeholder'}

`;

  const fileName = `${slug}.md`;
  const filePath = path.join(BLOG_DIR, fileName);
  fs.writeFileSync(filePath, frontmatter, 'utf-8');

  console.log(`\nNew post created: ${filePath}`);
  console.log(`\nFrontmatter generated:`);
  console.log(`  Description: ${meta.description || '(empty)'}`);
  console.log(`  Tags: ${(meta.tags || []).join(', ')}`);
  console.log(`  TL;DR: ${meta.tldr || '(empty)'}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Edit the post: ${filePath}`);
  console.log(`  2. Generate outline: node scripts/ai-writer.mjs outline "${title}"`);
  console.log(`  3. Polish when done: node scripts/ai-writer.mjs polish ${filePath}`);
}

// --- CLI ---
const [,, command, ...args] = process.argv;

async function main() {
  switch (command) {
    case 'outline':
      if (!args[0]) { console.error('Usage: ai-writer.mjs outline "Topic"'); process.exit(1); }
      await generateOutline(args.join(' '));
      break;

    case 'polish':
      if (!args[0]) { console.error('Usage: ai-writer.mjs polish <file-path>'); process.exit(1); }
      await polishDraft(args[0]);
      break;

    case 'translate':
      if (!args[0]) { console.error('Usage: ai-writer.mjs translate <file-path>'); process.exit(1); }
      await translatePost(args[0]);
      break;

    case 'new':
      if (!args[0]) { console.error('Usage: ai-writer.mjs new "Post Title"'); process.exit(1); }
      await newPost(args.join(' '));
      break;

    default:
      console.log(`
qing.uno AI Writing Assistant

Usage:
  node scripts/ai-writer.mjs outline "Topic"        Generate a blog post outline
  node scripts/ai-writer.mjs new "Title"             Create new post with AI-generated meta
  node scripts/ai-writer.mjs polish <file>           Polish a draft post
  node scripts/ai-writer.mjs translate <file>        Translate post (zh↔en)

Environment:
  OPENAI_API_KEY     Required. Your LLM API key
  OPENAI_BASE_URL    Optional. Custom API endpoint (for compatible APIs)
  LLM_MODEL          Optional. Model name (default: gpt-4o-mini)
      `);
  }
}

main().catch(console.error);
