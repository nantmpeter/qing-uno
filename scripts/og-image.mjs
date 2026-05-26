#!/usr/bin/env node

/**
 * OG Image Generator for qing.uno blog
 * Uses Satori to convert HTML/JSX to SVG, then @resvg/resvg-js to PNG
 *
 * Usage:
 *   node scripts/og-image.mjs              Generate for all posts
 *   node scripts/og-image.mjs <slug>       Generate for a specific post
 *
 * Output: public/og/<slug>.png
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = path.join(__dirname, '..', 'src', 'content', 'blog');
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'og');
const FONT_DIR = path.join(__dirname, '..', 'public', 'fonts');

const WIDTH = 1200;
const HEIGHT = 630;

// Ensure output dir exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Load font (use system font as fallback)
async function loadFonts() {
  const fontPaths = [
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    '/System/Library/Fonts/Supplemental/Helvetica.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ];

  for (const fp of fontPaths) {
    if (fs.existsSync(fp)) {
      console.log(`  Using font: ${fp}`);
      return fs.readFileSync(fp);
    }
  }

  console.warn('Warning: No suitable font found. OG images may not render correctly.');
  return null;
}

// Parse frontmatter from markdown
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const fm = {};
  const lines = match[1].split('\n');
  let currentKey = '';
  let inArray = false;

  for (const line of lines) {
    const arrayItemMatch = line.match(/^\s+-\s+['"]?(.*?)['"]?\s*$/);
    if (inArray && arrayItemMatch) {
      fm[currentKey].push(arrayItemMatch[1]);
      continue;
    }

    const arrMatch = line.match(/^(\w+):\s*\[(.*?)\]/);
    if (arrMatch) {
      fm[arrMatch[1]] = arrMatch[2].split(',').map(s => s.trim().replace(/['"]/g, ''));
      continue;
    }

    const kvMatch = line.match(/^(\w+):\s*\[(.*?)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      fm[currentKey] = kvMatch[2].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
      inArray = true;
      continue;
    }

    const closeArr = line.match(/^\s*\]$/);
    if (closeArr) { inArray = false; continue; }

    const simpleMatch = line.match(/^(\w+):\s*['"]?(.*?)['"]?\s*$/);
    if (simpleMatch) {
      fm[simpleMatch[1]] = simpleMatch[2];
      inArray = false;
    }
  }

  return fm;
}

// Generate OG image SVG
async function generateOGImage(title, description, tags, fontData) {
  const tagStr = (tags || []).slice(0, 3).map(t => `#${t}`).join('  ');

  const element = {
    type: 'div',
    props: {
      style: {
        width: WIDTH,
        height: HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '60px 70px',
        backgroundColor: '#0a0a0a',
        color: '#ffffff',
        fontFamily: 'Arial Unicode, Helvetica, system-ui, sans-serif',
      },
      children: [
        // Top bar
        {
          type: 'div',
          props: {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
            children: [
              { type: 'span', props: { style: { fontSize: 22, fontWeight: 700, color: '#3b82f6' }, children: 'qing.uno' } },
              { type: 'span', props: { style: { fontSize: 16, color: '#737373' }, children: tagStr } },
            ],
          },
        },
        // Title
        {
          type: 'div',
          props: {
            style: {
              fontSize: title.length > 40 ? 42 : title.length > 25 ? 50 : 58,
              fontWeight: 700,
              lineHeight: 1.25,
              letterSpacing: '-0.02em',
              maxWidth: WIDTH - 140,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
            },
            children: title,
          },
        },
        // Description
        {
          type: 'div',
          props: {
            style: {
              fontSize: 20,
              color: '#a3a3a3',
              lineHeight: 1.5,
              maxWidth: WIDTH - 140,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            },
            children: description || '',
          },
        },
        // Bottom accent line
        {
          type: 'div',
          props: {
            style: {
              width: 80,
              height: 4,
              backgroundColor: '#3b82f6',
              borderRadius: 2,
            },
          },
        },
      ],
    },
  };

  const fonts = fontData ? [{ name: 'Arial Unicode', data: fontData, weight: 400, style: 'normal' }] : [];

  const svg = await satori(element, {
    width: WIDTH,
    height: HEIGHT,
    fonts,
  });

  // Convert to PNG
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: WIDTH },
  });
  const pngData = resvg.render();
  return pngData.asPng();
}

// Main
async function main() {
  const fontData = await loadFonts();
  const targetSlug = process.argv[2];

  const files = fs.readdirSync(BLOG_DIR).filter(f => f.endsWith('.md'));

  for (const file of files) {
    const content = fs.readFileSync(path.join(BLOG_DIR, file), 'utf-8');
    const fm = parseFrontmatter(content);
    const slug = file.replace('.md', '');

    if (targetSlug && slug !== targetSlug) continue;
    if (fm.draft === 'true') continue;

    const title = fm.title || 'Untitled';
    const description = fm.description || '';
    const tags = Array.isArray(fm.tags) ? fm.tags : [];

    console.log(`Generating OG image: ${slug}`);

    try {
      const png = await generateOGImage(title, description, tags, fontData);
      const outputPath = path.join(OUTPUT_DIR, `${slug}.png`);
      fs.writeFileSync(outputPath, png);
      console.log(`  -> ${outputPath}`);
    } catch (err) {
      console.error(`  Error generating for ${slug}: ${err.message}`);
    }
  }

  console.log('\nDone!');
}

main().catch(console.error);
