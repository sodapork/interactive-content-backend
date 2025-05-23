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
  // Try to get main content area
  const main = doc.querySelector('main') || doc.body;
  const style = dom.window.getComputedStyle(main);

  // Typography
  const typography = {
    fontFamily: style.fontFamily || '',
    fontSize: style.fontSize || '',
    fontWeight: style.fontWeight || '',
    lineHeight: style.lineHeight || '',
    letterSpacing: style.letterSpacing || '',
    textAlign: style.textAlign || '',
    color: style.color || '',
  };

  // Colors and Background
  const colors = {
    backgroundColor: style.backgroundColor || '',
    color: style.color || '',
    borderColor: style.borderColor || '',
  };

  // Spacing
  const spacing = {
    padding: style.padding || '',
    margin: style.margin || '',
    gap: style.gap || '',
  };

  // Component Styles
  const components = {};
  
  // Button styles
  const button = doc.querySelector('button');
  if (button) {
    const btnStyle = dom.window.getComputedStyle(button);
    components.button = {
      backgroundColor: btnStyle.backgroundColor || '',
      color: btnStyle.color || '',
      border: btnStyle.border || '',
      borderRadius: btnStyle.borderRadius || '',
      padding: btnStyle.padding || '',
      fontSize: btnStyle.fontSize || '',
      fontWeight: btnStyle.fontWeight || '',
      boxShadow: btnStyle.boxShadow || '',
    };
  }

  // Input styles
  const input = doc.querySelector('input');
  if (input) {
    const inputStyle = dom.window.getComputedStyle(input);
    components.input = {
      border: inputStyle.border || '',
      borderRadius: inputStyle.borderRadius || '',
      padding: inputStyle.padding || '',
      fontSize: inputStyle.fontSize || '',
      backgroundColor: inputStyle.backgroundColor || '',
    };
  }

  // Link styles
  const link = doc.querySelector('a');
  if (link) {
    const linkStyle = dom.window.getComputedStyle(link);
    components.link = {
      color: linkStyle.color || '',
      textDecoration: linkStyle.textDecoration || '',
      fontWeight: linkStyle.fontWeight || '',
    };
  }

  // Build a detailed style summary
  const styleSummary = {
    typography,
    colors,
    spacing,
    components,
  };

  // Convert to a more readable string format
  return JSON.stringify(styleSummary, null, 2);
}

app.post('/extract', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  try {
    const response = await axios.get(url);
    const dom = new JSDOM(response.data, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    // Extract style summary
    const styleSummary = extractStyleSummary(dom);
    res.json({
      title: article.title,
      content: article.textContent,
      html: article.content,
      styleSummary
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to extract content', details: err.message });
  }
});

// Generate 5 tool ideas
app.post('/ideas', async (req, res) => {
  const { content, styleSummary } = req.body;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are an expert at creating interactive web tools for blog content. Given a blog post, suggest 5 highly relevant and engaging interactive tool ideas (such as calculators, quizzes, checklists, or comparison charts) that would add value for readers. Respond with a numbered list of 5 short, clear tool ideas. Do not include explanations or markdown.`
        },
        {
          role: "user",
          content: `Suggest 5 interactive tool ideas for this blog post: ${content}${styleSummary ? `\n\nThe blog uses the following style: ${styleSummary}` : ''}`
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
  const { content, idea, styleSummary } = req.body;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are an expert at generating robust, interactive web tools for blog content. Based on the following idea, generate a complete, self-contained HTML and JavaScript snippet for the tool, with a professional, accessible, and visually appealing UI (inputs, buttons, etc.), minimal inline CSS, and all necessary logic.

Requirements:
- The tool must include input validation, user feedback for errors, and display results in a clear, user-friendly way.
- Where appropriate, use visual elements (charts, progress bars, etc.) to enhance understanding.
- Allow users to customize parameters and reset the tool.
- Provide tooltips or inline help for any non-obvious controls.
- Solve a real problem for readers and, where possible, summarize results or suggest next steps.
- Ensure the UI is responsive and works well on both desktop and mobile devices.
- Use proper spacing, consistent styling, and match the provided style summary as closely as possible.

Embedding instructions:
- Output only the code for the embeddable widget.
- Do NOT include <!DOCTYPE html>, <html>, <head>, or <body> tags.
- Output the <style> tag first, then the HTML markup, then the <script> tag at the end.
- Never nest <style> or <script> tags inside each other.
- Do NOT wrap the entire output in a <script> tag.
- The code should be ready to paste into a WordPress HTML element or similar CMS widget.
- Do not include any markdown, triple backticks, or explanations—just the raw HTML, CSS, and JS.

Style matching instructions:
- Parse the provided style summary JSON and apply the styles to your generated tool
- Match typography (font family, size, weight, line height)
- Use the same color scheme (background, text, borders)
- Apply consistent spacing patterns
- Match component styles (buttons, inputs, links) exactly
- Ensure all interactive elements follow the site's design language

${styleSummary ? `Style summary to match:\n${styleSummary}` : ''}`
        },
        {
          role: "user",
          content: `Blog content: ${content}\n\nTool idea: ${idea}`
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
      model: "gpt-4",
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
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${repo}/contents?ref=${branch}`
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
    res.status(500).json({ error: 'Failed to fetch recent tools', details: err.message });
  }
});

const PORT = 5001;
app.listen(PORT, () => {
  console.log(`Content extraction server running on port ${PORT}`);
}); 