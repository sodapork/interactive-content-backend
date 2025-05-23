require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const OpenAI = require('openai');

// Store your OpenAI API key here (or use dotenv for production)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const app = express();
app.use(cors({
  origin: [
    'https://interactive-content-frontend.vercel.app',
    'http://localhost:3000'
  ],
  credentials: true
}));
app.use(express.json());

function extractStyleSummary(dom) {
  const doc = dom.window.document;

  // Try to get main content container
  const main = doc.querySelector('main, #main-content, .site-content, .post, body') || doc.body;

  // Try to get a sample p, h1, button, input
  const p = main.querySelector('p');
  const h1 = main.querySelector('h1');
  const button = main.querySelector('button');
  const input = main.querySelector('input');

  function getStyles(el) {
    if (!el) return {};
    const style = dom.window.getComputedStyle(el);
    return {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      color: style.color,
      backgroundColor: style.backgroundColor,
      border: style.border,
      borderRadius: style.borderRadius,
      padding: style.padding,
    };
  }

  return {
    body: getStyles(doc.body),
    main: getStyles(main),
    p: getStyles(p),
    h1: getStyles(h1),
    button: getStyles(button),
    input: getStyles(input),
  };
}

app.post('/extract', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      },
      timeout: 10000,
    });

    const dom = new JSDOM(response.data, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.textContent || !article.textContent.trim()) {
      console.warn('Extraction failed or content empty for URL:', url);
      return res.status(500).json({ error: 'Failed to extract main content from the URL.' });
    }

    const styleSummary = extractStyleSummary(dom);

    console.log('Extracted content for URL:', url, '\nTitle:', article.title, '\nContent:', article.textContent.slice(0, 300), '...');
    console.log('Extracted style summary:', styleSummary);

    res.json({
      title: article.title,
      content: article.textContent,
      html: article.content,
      styleSummary,
    });
  } catch (err) {
    console.error('Error in /extract:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to extract content', details: err.message });
  }
});

// Generate 5 tool ideas
app.post('/ideas', async (req, res) => {
  const { content } = req.body;
  try {
    // Log the content being sent to OpenAI
    console.log('OpenAI /ideas prompt content:', content.slice(0, 500));
    const completion = await openai.chat.completions.create({
      model: "gpt-4-1106-preview",
      messages: [
        {
          role: "system",
          content: `You are an expert at creating interactive web tools for blog content. Given a blog post, suggest 5 highly relevant and engaging interactive tool ideas (such as calculators, quizzes, checklists, or comparison charts) that would add value for readers. Respond with a numbered list of 5 short, clear tool ideas. Do not include explanations or markdown.`
        },
        {
          role: "user",
          content: `Suggest 5 interactive tool ideas for this blog post: ${content}`
        }
      ],
    });
    const text = completion.choices[0].message.content || '';
    const ideas = text
      .split(/\n+/)
      .map(line => line.replace(/^\d+\.\s*/, '').trim())
      .filter(Boolean);
    res.json({ ideas });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate tool ideas', details: err.message });
  }
});

// Generate a tool for a selected idea
app.post('/generate', async (req, res) => {
  const { content, idea, styleSummary, userRequirements } = req.body;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4-1106-preview",
      messages: [
        {
          role: "system",
          content: `You are an expert at creating highly engaging, complex, and interactive web tools for blog content. Given a blog post and user requirements, generate a sophisticated, ultra-engaging tool that is directly relevant to the post's topic and provides real value to readers.

Requirements:
- The tool should be more than a simple calculator or checklist; it should include advanced interactivity, dynamic feedback, and multiple steps or features if appropriate.
- Make the tool visually appealing, modern, and professional.
- Ensure the tool is highly relevant to the provided blog content and tailored to the target audience.
- Use creative elements: animations, progress bars, charts, branching logic, or gamification if it fits the context.
- Match the style, color scheme, and typography of the source site as closely as possible (see provided style summary).
- Output only the embeddable widget code (no html/head/body).
- Do not include markdown, triple backticks, or explanations—just the raw HTML, CSS, and JS.`
        },
        {
          role: "user",
          content: `Blog content: ${content}\n\nStyle summary: ${styleSummary || ''}\n\nUser requirements: ${userRequirements || idea || ''}`
        }
      ],
    });
    res.json({ tool: completion.choices[0].message.content || '' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate tool', details: err.message });
  }
});

// Update a tool with user feedback
app.post('/update', async (req, res) => {
  const { content, currentTool, feedback } = req.body;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4-1106-preview",
      messages: [
        {
          role: "system",
          content: `You are an expert at updating interactive tools for blog content. Here is the original blog post: ${content}. Here is the current tool code: ${currentTool}. The user wants the following changes: ${feedback}. Please update the tool accordingly. Return only the updated, complete HTML+JS code, no explanations or markdown.`
        }
      ],
    });
    res.json({ tool: completion.choices[0].message.content || '' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update tool', details: err.message });
  }
});

app.post('/publish', async (req, res) => {
  const { filename, html } = req.body;
  if (!filename || !html) return res.status(400).json({ error: 'Missing filename or html' });

  const repo = 'sodapork/interactive-tools';
  const branch = 'gh-pages';
  const path = filename.endsWith('.html') ? filename : `${filename}.html`;
  const githubToken = process.env.GITHUB_TOKEN;

  // Get the current file SHA if it exists (for updates)
  let sha = undefined;
  try {
    const getResp = await axios.get(
      `https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`,
      { headers: { Authorization: `token ${githubToken}` } }
    );
    sha = getResp.data.sha;
  } catch (e) {
    // File does not exist, that's fine
  }

  // Create or update the file
  try {
    await axios.put(
      `https://api.github.com/repos/${repo}/contents/${path}`,
      {
        message: `Publish tool: ${path}`,
        content: Buffer.from(html).toString('base64'),
        branch,
        ...(sha ? { sha } : {})
      },
      { headers: { Authorization: `token ${githubToken}` } }
    );
    const url = `https://sodapork.github.io/interactive-tools/${path}`;
    res.json({ url });
  } catch (err) {
    console.error('Error in /publish:', err.response ? err.response.data : err.message, err.stack);
    res.status(500).json({ error: 'Failed to publish tool', details: err.message });
  }
});

app.get('/recent', async (req, res) => {
  const repo = 'sodapork/interactive-tools';
  const branch = 'gh-pages';
  const githubToken = process.env.GITHUB_TOKEN;
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${repo}/contents?ref=${branch}`,
      githubToken
        ? { headers: { Authorization: `token ${githubToken}` } }
        : undefined
    );
    // Filter for .html files only
    const files = response.data
      .filter(file => file.name.endsWith('.html'))
      .map(file => ({
        name: file.name,
        url: `https://sodapork.github.io/interactive-tools/${file.name}`,
        sha: file.sha
      }))
      .reverse(); // newest last (or sort by sha if you want newest first)
    res.json({ tools: files });
  } catch (err) {
    console.error('Error in /recent:', err.response ? err.response.data : err.message, err.stack);
    res.status(500).json({ error: 'Failed to fetch recent tools', details: err.message });
  }
});

const PORT = 5001;
app.listen(PORT, () => {
  console.log(`Content extraction server running on port ${PORT}`);
}); 