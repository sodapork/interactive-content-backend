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
app.use(cors());
app.use(express.json());

app.post('/extract', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  try {
    const response = await axios.get(url);
    const dom = new JSDOM(response.data, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    res.json({
      title: article.title,
      content: article.textContent,
      html: article.content
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to extract content', details: err.message });
  }
});

// Generate 5 tool ideas
app.post('/ideas', async (req, res) => {
  const { content } = req.body;
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
  const { content, idea } = req.body;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are an expert at generating interactive tools for blog content. Based on the following idea, generate a complete, self-contained HTML and JavaScript snippet for the tool, with a simple UI (inputs, buttons, etc.), minimal inline CSS, and all necessary logic. The tool should be directly related to the blog's subject and provide real value to readers. Do not include markdown, triple backticks, or explanations—just the raw HTML+JS code.`
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

const PORT = 5001;
app.listen(PORT, () => {
  console.log(`Content extraction server running on port ${PORT}`);
}); 