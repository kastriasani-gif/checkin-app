const REPO_OWNER = "kastriasani-gif";
const REPO_NAME = "checkin-app";
const DATA_PATH = "data.json";
const BRANCH = "main";

const API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}`;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function setCors(req, res) {
  const origin = req.headers.origin;

  if (!origin || allowedOrigins().length === 0 || allowedOrigins().includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function allowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function isAllowedOrigin(req) {
  const allowed = allowedOrigins();
  const origin = req.headers.origin;
  return allowed.length === 0 || (origin && allowed.includes(origin));
}

async function readData() {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(`${API_URL}?ref=${BRANCH}`, { headers });
  if (res.status === 404) {
    return { data: { sessions: [] }, sha: null };
  }
  if (!res.ok) {
    throw new Error(`GitHub read failed (${res.status})`);
  }

  const json = await res.json();
  const content = Buffer.from(json.content.replace(/\n/g, ""), "base64").toString("utf8");
  const parsed = JSON.parse(content);
  return {
    data: parsed && Array.isArray(parsed.sessions) ? parsed : { sessions: [] },
    sha: json.sha,
  };
}

async function writeData(data, sha) {
  if (!process.env.GITHUB_TOKEN) {
    const err = new Error("Missing GITHUB_TOKEN");
    err.statusCode = 500;
    throw err;
  }
  if (!data || !Array.isArray(data.sessions)) {
    const err = new Error("Invalid data shape");
    err.statusCode = 400;
    throw err;
  }

  const body = {
    message: "update sessions",
    content: Buffer.from(JSON.stringify(data, null, 2) + "\n", "utf8").toString("base64"),
    branch: BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await fetch(API_URL, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`GitHub write failed (${res.status}): ${text}`);
    err.statusCode = res.status === 409 ? 409 : 502;
    throw err;
  }

  const json = await res.json();
  return json.content.sha;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks
    .map((chunk) => (Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)))
    .join("");
  return JSON.parse(body || "{}");
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    if (req.method === "GET") {
      const current = await readData();
      send(res, 200, current);
      return;
    }

    if (req.method === "PUT") {
      if (!isAllowedOrigin(req)) {
        send(res, 403, { error: "Origin not allowed" });
        return;
      }
      const { data, sha } = await readBody(req);
      const nextSha = await writeData(data, sha);
      send(res, 200, { ok: true, sha: nextSha });
      return;
    }

    send(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    send(res, error.statusCode || 500, { error: error.message || "Server error" });
  }
};
