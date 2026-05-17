import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { createHmac } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const client = new Anthropic();

const COOKIE_ATTRS = "HttpOnly; SameSite=Lax; Path=/";

const OUTPUT_CONFIG = {
  format: {
    type: "json_schema",
    schema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["questions"],
      additionalProperties: false,
    },
  },
};

function makeToken() {
  const { AUTH_USERNAME, AUTH_PASSWORD, SESSION_SECRET } = process.env;
  if (!AUTH_USERNAME || !AUTH_PASSWORD || !SESSION_SECRET) return null;
  return createHmac("sha256", SESSION_SECRET)
    .update(`${AUTH_USERNAME}:${AUTH_PASSWORD}`)
    .digest("hex");
}

const _token = makeToken();

function getAuthCookie(req) {
  const header = req.headers.cookie || "";
  const pair = header.split(";").map((c) => c.trim()).find((c) => c.startsWith("auth="));
  return pair ? pair.slice(5) : null;
}

function isAuthenticated(req) {
  return _token !== null && getAuthCookie(req) === _token;
}

function loginHTML(errorMsg = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>InterviewLens — Sign In</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f5f7fa; color: #1a1a2e; min-height: 100vh;
      display: flex; align-items: center; justify-content: center; padding: 1.5rem;
    }
    .card {
      background: #fff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      padding: 2.5rem 2rem; width: 100%; max-width: 380px;
    }
    h1 { font-size: 1.6rem; font-weight: 700; margin-bottom: 0.4rem; }
    .subtitle { color: #6b7280; font-size: 0.95rem; margin-bottom: 2rem; }
    label { display: block; font-weight: 600; font-size: 0.9rem; margin-bottom: 0.5rem; }
    input {
      width: 100%; border: 1.5px solid #d1d5db; border-radius: 8px;
      padding: 0.65rem 1rem; font-size: 1rem; outline: none;
      transition: border-color 0.15s; margin-bottom: 1.25rem;
    }
    input:focus { border-color: #4f46e5; }
    button {
      width: 100%; background: #4f46e5; color: #fff; border: none; border-radius: 8px;
      padding: 0.65rem 1.4rem; font-size: 1rem; font-weight: 600; cursor: pointer;
      transition: background 0.15s;
    }
    button:hover { background: #4338ca; }
    .error {
      margin-bottom: 1.25rem; background: #fef2f2; border: 1px solid #fecaca;
      border-radius: 8px; padding: 0.75rem 1rem; color: #b91c1c; font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>InterviewLens</h1>
    <p class="subtitle">Sign in to continue.</p>
    ${errorMsg ? `<div class="error">${errorMsg}</div>` : ""}
    <form method="POST" action="/login">
      <label for="username">Username</label>
      <input type="text" id="username" name="username" autocomplete="username" autofocus />
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autocomplete="current-password" />
      <button type="submit">Sign In</button>
    </form>
  </div>
</body>
</html>`;
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  if (req.accepts("html")) return res.redirect("/login");
  res.status(401).json({ error: "Unauthorized. Please log in." });
}

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get("/login", (req, res) => {
  if (isAuthenticated(req)) return res.redirect("/");
  res.send(loginHTML());
});

app.post("/login", (req, res) => {
  const { AUTH_USERNAME, AUTH_PASSWORD } = process.env;
  const { username, password } = req.body;

  if (username === AUTH_USERNAME && password === AUTH_PASSWORD) {
    res.setHeader("Set-Cookie", `auth=${_token}; ${COOKIE_ATTRS}; Max-Age=2592000`);
    return res.redirect("/");
  }

  res.status(401).send(loginHTML("Incorrect username or password."));
});

app.post("/logout", (req, res) => {
  res.setHeader("Set-Cookie", `auth=; ${COOKIE_ATTRS}; Max-Age=0`);
  res.redirect("/login");
});

app.use(requireAuth);
app.use(express.static(join(__dirname, "..", "public")));

app.post("/api/questions", async (req, res) => {
  const { jobTitle } = req.body;
  const title = typeof jobTitle === "string" ? jobTitle.trim() : "";

  if (!title) {
    return res.status(400).json({ error: "A job title is required." });
  }

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 1024,
      system:
        'You are an expert interviewer. When given a job title, generate exactly 3 thoughtful, role-specific interview questions that reveal a candidate\'s depth of experience, problem-solving ability, and cultural fit. Return ONLY a JSON object with a single key "questions" whose value is an array of exactly 3 strings. No extra text.',
      messages: [
        {
          role: "user",
          content: `Generate 3 interview questions for a ${title} role.`,
        },
      ],
      output_config: OUTPUT_CONFIG,
    });

    const block = response.content.find((b) => b.type === "text");
    if (!block) throw new Error("No text block in API response");
    const { questions } = JSON.parse(block.text);
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error("Unexpected response format from API");
    }
    res.json({ questions });
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key. Check your ANTHROPIC_API_KEY." });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "Rate limited. Please try again in a moment." });
    }
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default app;
