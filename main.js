require('dotenv').config();
const express = require("express");
const axios = require('axios');
const { URLSearchParams } = require('url');
const { NONAME } = require('dns');

const app = express();
const port = process.env.PORT || 2816;
const CF_WORKER_URL = process.env.CF_WORKER_URL || "https://discord-kv-writer.rookiecookierc-eb5.workers.dev";

async function saveUserToKV(user) {
  try {
    const payload = {
      id: user.id,
      username: user.username,
      email: user.email || null,
      avatar: user.avatar || null,
      banner: user.banner || null,
      fetchedAt: Date.now()
    };

    await axios.post(`${CF_WORKER_URL}/store`, payload, {
      headers: { "Content-Type": "application/json" },
      // If you want to add a simple shared secret, you can via a header:
      // headers: { "Content-Type": "application/json", "x-auth": process.env.SHARED_SECRET }
    });
    console.log(`KV: stored user ${user.id}`);
  } catch (err) {
    console.error("KV write failed:", err.response?.data || err.message);
  }
}

app.get('/api/auth', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("No code provided");

  try {
    // 1) exchange code for tokens
    const formData = new URLSearchParams({
      client_id: process.env.cid,
      client_secret: process.env.csec,
      grant_type: 'authorization_code',
      code: code.toString(),
      redirect_uri: `https://superfood-bot-testing.onrender.com/api/auth`
    });

    const tokenResp = await axios.post(
      'https://discord.com/api/v10/oauth2/token',
      formData.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const tokens = tokenResp.data;

    // 2) get user info
    const userResp = await axios.get('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const user = userResp.data;

    // 2.5) persist to KV (no token required; Worker handles storage)
    await saveUserToKV(user);

    // 3) optional: join guilds using your bot
    const guilds = (process.env.GUILD_IDS || "").split(",").map(g => g.trim()).filter(Boolean);

    for (let i = 0; i < guilds.length; i++) {
      const guildId = guilds[i];

      if (i > 0) {
        console.log(`Waiting 30 seconds before joining guild ${guildId}...`);
        await new Promise(resolve => setTimeout(resolve, 30000));
      }

      try {
        console.log(`Joining guild ${guildId} with user ${user.id}`);
        const joinRes = await axios.put(
          `https://discord.com/api/v10/guilds/${guildId}/members/${user.id}`,
          { access_token: tokens.access_token },
          {
            headers: {
              Authorization: `Bot ${process.env.token}`,
              "Content-Type": "application/json"
            }
          }
        );
        console.log(`Joined guild ${guildId}:`, joinRes.status);
      } catch (err) {
        console.error(`Failed to join guild ${guildId}:`, err.response?.status, err.response?.data || err.message);
      }
    }
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>thank you for helping</title>
  <style>
    body {
      background: #0f0f0f;
      color: #00ffcc;
      font-family: 'Courier New', monospace;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      overflow: hidden;
      position: relative;
    }
    canvas { position: absolute; inset: 0; z-index: 0; }
    h1 {
      font-size: 2rem;
      margin-bottom: 1rem;
      text-shadow: 0 0 10px #00ffcc;
      z-index: 1;
    }
    .progress-container {
      width: 80%;
      max-width: 600px;
      margin-top: 2rem;
      z-index: 1;
    }
    .guild { margin-bottom: 1.5rem; }
    .label { margin-bottom: 0.5rem; font-size: 1rem; }
    .bar {
      width: 100%;
      height: 20px;
      background: #222;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 0 10px #00ffcc55;
    }
    .fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(to right, #00ffcc, #00e6b3);
      animation: fill 30s linear forwards;
    }
    @keyframes fill { to { width: 100%; } }
  </style>
</head>
<body>
  <canvas id="particles"></canvas>
  <h1>thank you for helping me test!</h1>
  <div class="progress-container">
    ${guilds.map((id, i) => `
      <div class="guild">
        <div class="bar">
          <div class="fill" style="
            animation-delay: ${i * 17}s;
            background: linear-gradient(to right, hsl(${i * 45}, 100%, 60%), #00e6b3);
          "></div>
        </div>
      </div>
    `).join("")}
  </div>
  <script>
    const canvas = document.getElementById("particles");
    const ctx = canvas.getContext("2d");
    let w = canvas.width = window.innerWidth;
    let h = canvas.height = window.innerHeight;
    const particles = Array.from({ length: 80 }, () => ({
      x: Math.random() * w, y: Math.random() * h, r: Math.random() * 2 + 1,
      dx: (Math.random() - 0.5) * 0.7, dy: (Math.random() - 0.5) * 0.7
    }));
    function animate() {
      ctx.clearRect(0,0,w,h);
      ctx.fillStyle = "rgba(0,255,180,0.8)";
      ctx.shadowColor = "rgba(0,255,180,0.9)";
      ctx.shadowBlur = 8;
      particles.forEach(p => {
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
        p.x += p.dx; p.y += p.dy;
        if (p.x < 0 || p.x > w) p.dx = -p.dx;
        if (p.y < 0 || p.y > h) p.dy = -p.dy;
      });
      requestAnimationFrame(animate);
    }
    animate();
    window.addEventListener("resize", () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    });
  </script>
</body>
</html>
`);
  } catch (e) {
    console.error("Critical error:", e.response?.status, e.response?.data || e.message);
    res.status(500).send("Something went wrong");
  }
});

app.get('/invite', (req, res) => {
  const clientId = process.env.cid;
  const permissions = '8';
  const scopes = 'bot applications.commands';

  const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=${scopes}&response_type=code`;

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
      <title>Invite Bot</title>
      <style>
          body {
              background: #0f0f0f;
              color: #00ffcc;
              font-family: 'Segoe UI', sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
          }
          .card {
              background: #1a1a1a;
              padding: 2rem;
              border-radius: 12px;
              box-shadow: 0 0 20px #00ffcc55;
              text-align: center;
              max-width: 400px;
          }
          h1 { margin-bottom: 1rem; font-size: 1.8rem; color: #00ffcc; }
          a.button {
              display: inline-block;
              padding: 0.75rem 1.5rem;
              background: #00ffcc;
              color: #000;
              font-weight: bold;
              text-decoration: none;
              border-radius: 8px;
              transition: all 0.3s ease;
              box-shadow: 0 0 10px #00ffcc88;
          }
          a.button:hover {
              background: #00e6b3;
              box-shadow: 0 0 20px #00ffccaa;
              transform: scale(1.05);
          }
      </style>
  </head>
  <body>
      <div class="card">
          <h1>Invite the Bot</h1>
          <a class="button" href="${inviteUrl}" target="_blank">Add to Server</a>
      </div>
  </body>
  </html>
  `;
  res.send(html);
});

app.get('/', (req, res) => {
  const state = Math.random().toString(36).substring(2, 15);
  const oauthParams = new URLSearchParams({
    client_id: process.env.cid,
    redirect_uri: `https://superfood-bot-testing.onrender.com/api/auth`,
    response_type: "code",
    scope: "identify email guilds.join",
    state
  });
  const oauthUrl = `https://discord.com/oauth2/authorize?${oauthParams.toString()}`;

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
      <title>testing dashboard</title>
      <style>
          body {
              background: radial-gradient(circle at top left, #0f0f0f, #000);
              font-family: 'Segoe UI', sans-serif;
              color: #eee;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              overflow: hidden;
              position: relative;
          }
          canvas { position: absolute; inset: 0; z-index: 0; }
          .card {
              position: relative; z-index: 1;
              background: #1a1a1a;
              padding: 2rem;
              border-radius: 12px;
              box-shadow: 0 0 20px #00ffcc55;
              text-align: center;
              max-width: 420px;
              animation: fadeIn 0.8s ease-out both;
          }
          h1 { margin-bottom: 1rem; font-size: 1.8rem; color: #00ffcc; text-shadow: 0 0 10px #00ffcc; }
          p { margin-bottom: 2rem; font-size: 1rem; color: #ccc; }
          a.button {
              display: inline-block;
              padding: 0.75rem 1.5rem;
              background: #00ffcc;
              color: #000;
              font-weight: bold;
              text-decoration: none;
              border-radius: 8px;
              transition: all 0.3s ease;
              box-shadow: 0 0 10px #00ffcc88;
          }
          a.button:hover { background: #00e6b3; box-shadow: 0 0 20px #00ffccaa; transform: scale(1.05); }
          @keyframes fadeIn { from {opacity: 0; transform: translateY(12px);} to {opacity:1; transform:translateY(0);} }
      </style>
  </head>
  <body>
      <canvas id="particles"></canvas>
      <div class="card">
          <h1>bot testing</h1>
          <p>Click below to help test.</p>
          <a class="button" href="${oauthUrl}">auth for test</a>
      </div>
      <script>
        const canvas = document.getElementById("particles");
        const ctx = canvas.getContext("2d");
        let w = canvas.width = window.innerWidth;
        let h = canvas.height = window.innerHeight;
        const particles = Array.from({ length: 80 }, () => ({
          x: Math.random() * w, y: Math.random() * h, r: Math.random() * 2 + 1,
          dx: (Math.random() - 0.5) * 0.7, dy: (Math.random() - 0.5) * 0.7
        }));
        function animate() {
          ctx.clearRect(0,0,w,h);
          ctx.fillStyle = "rgba(0,255,180,0.8)";
          ctx.shadowColor = "rgba(0,255,180,0.9)";
          ctx.shadowBlur = 8;
          particles.forEach(p => {
            ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
            p.x += p.dx; p.y += p.dy;
            if (p.x < 0 || p.x > w) p.dx = -p.dx;
            if (p.y < 0 || p.y > h) p.dy = -p.dy;
          });
          requestAnimationFrame(animate);
        }
        animate();
        window.addEventListener("resize", () => {
          w = canvas.width = window.innerWidth;
          h = canvas.height = window.innerHeight;
        });
      </script>
  </body>
  </html>
  `;
  res.send(html);
});

console.log("About to start server...");
app.listen(port, () => console.log(`Started on ${port}`));
