require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, PermissionFlagsBits, Partials } = require('discord.js');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// --- DATABASE & FILE SETUP ---
const uploadDir = path.join(__dirname, 'uploads');
const statsFile = path.join(__dirname, 'stats.json');
const settingsFile = path.join(__dirname, 'guildSettings.json');
const verifiedUsersFile = path.join(__dirname, 'verifiedUsers.json');
const blacklistFile = path.join(__dirname, 'blacklist.json');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const app = express();
const upload = multer({ dest: 'uploads/' });
const pendingVerifications = new Map(); 

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel, Partials.User, Partials.GuildMember]
});

// --- MODERN FANTASY UI ENGINE ---
const CSS = `<style>
    @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Inter:wght@300;400;600&display=swap');
    :root { 
        --obsidian-bg: #0f1115; --parchment-text: #e2e8f0; --arcane-glow: #8b5cf6; 
        --elven-gold: #fbbf24; --void-surface: rgba(30, 32, 40, 0.7); 
        --danger: #ef4444; --success: #10b981; --font-heading: 'Cinzel', serif; 
        --font-body: 'Inter', sans-serif;
    }
    body { font-family: var(--font-body); background-color: var(--obsidian-bg); color: var(--parchment-text); margin: 0; display: flex; flex-direction: column; align-items: center; min-height: 100vh; padding: 20px; }
    .container { width: 100%; max-width: 1000px; }
    .card { background: var(--void-surface); border: 1px solid rgba(251, 191, 36, 0.3); border-radius: 12px; padding: 25px; margin-bottom: 20px; backdrop-filter: blur(10px); box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
    .btn { background: linear-gradient(135deg, #6d28d9 0%, #4c1d95 100%); color: white; padding: 10px 20px; border-radius: 6px; cursor: pointer; text-decoration: none; font-family: var(--font-heading); border:none; transition: 0.3s; }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 0 15px var(--arcane-glow); }
    .btn-danger { background: #991b1b; } .btn-success { background: #065f46; }
    .nav { margin-bottom: 30px; display: flex; gap: 15px; justify-content: center; flex-wrap: wrap; background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; }
    .nav a { color: var(--parchment-text); text-decoration: none; font-family: var(--font-heading); padding: 5px 10px; font-size: 0.9rem; }
    .nav a.active { color: var(--elven-gold); border-bottom: 2px solid var(--elven-gold); }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th, td { padding: 12px; border-bottom: 1px solid rgba(139, 92, 246, 0.2); text-align: left; }
    th { color: var(--elven-gold); font-family: var(--font-heading); }
    code { background: #000; color: var(--elven-gold); padding: 2px 5px; border-radius: 4px; }
    input[type="text"], .search-input { background: rgba(0,0,0,0.5); border: 1px solid var(--arcane-glow); color: white; padding: 10px; border-radius: 4px; width: 100%; box-sizing: border-box; margin-bottom: 10px; }
</style>`;

const NAV = (active) => `<div class="nav">
    <a href="/admin-review" class="${active==='queue'?'active':''}">Review Queue</a>
    <a href="/admin-users" class="${active==='users'?'active':''}">Entities</a>
    <a href="/admin-servers" class="${active==='servers'?'active':''}">Realms</a>
    <a href="/admin-stats" class="${active==='stats'?'active':''}">Council Stats</a>
    <a href="/logout">Depart</a>
</div>`;

// --- DATA HELPERS ---
const getJSON = (file, def = []) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : def;
const saveJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

[statsFile, settingsFile, verifiedUsersFile, blacklistFile].forEach(f => { 
    if (!fs.existsSync(f)) saveJSON(f, f.endsWith('s.json') ? {} : []); 
});

const isGloballyVerified = (id) => getJSON(verifiedUsersFile).includes(id);
const isBlacklisted = (id) => getJSON(blacklistFile).includes(id);

// --- GLOBAL ROLE REMOVER ---
async function revokeGlobalRoles(userId) {
    const settings = getJSON(settingsFile, {});
    for (const [guildId, config] of Object.entries(settings)) {
        try {
            const guild = await client.guilds.fetch(guildId).catch(() => null);
            if (!guild) continue;
            const member = await guild.members.fetch(userId).catch(() => null);
            if (member && config.roleId) {
                await member.roles.remove(config.roleId).catch(() => null);
            }
        } catch (e) { console.error(`Failed revocation in ${guildId}`); }
    }
}

function recordStat(adminId, action) {
    let s = getJSON(statsFile, {});
    if (!s[adminId]) s[adminId] = { approvals: 0, denials: 0 };
    action === 'approve' ? s[adminId].approvals++ : s[adminId].denials++;
    saveJSON(statsFile, s);
}

// --- EXPRESS APP ---
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'mystic_portal_secret', resave: false, saveUninitialized: false }));

app.get('/', (req, res) => res.send(`${CSS}<div class="container" style="text-align:center;"><div class="card"><h1>🛡️ Portal Entrance</h1><a href="/auth/discord" class="btn">Authenticate via Discord</a></div></div>`));

app.get('/auth/discord', (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify%20guilds.members.read`;
    res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
    try {
        const tokenResp = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.CLIENT_ID, client_secret: process.env.CLIENT_SECRET,
            code: req.query.code, grant_type: 'authorization_code', redirect_uri: process.env.REDIRECT_URI
        }));
        const userResp = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tokenResp.data.access_token}` } });
        const staffGuild = await client.guilds.fetch(process.env.STAFF_GUILD_ID);
        const member = await staffGuild.members.fetch(userResp.data.id);
        if (member.roles.cache.has(process.env.STAFF_ROLE_ID)) {
            req.session.authenticated = true;
            req.session.adminId = userResp.data.id;
            return res.redirect('/admin-review');
        }
        res.send("Access Denied.");
    } catch (e) { res.send(`Auth Error: ${e.message}`); }
});

// --- ADMIN PAGES ---
app.get('/admin-review', (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    let cards = '';
    pendingVerifications.forEach((val, key) => {
        if (val.status === 'pending_review') {
            cards += `<div class="card"><h3>Subject ID: <code>${val.userId}</code></h3><img src="/view-id/${val.filename}" style="width:100%; max-height:450px; object-fit:contain; border-radius:8px; border:2px solid var(--arcane-glow); margin:15px 0;"><form action="/decide" method="POST"><input type="hidden" name="token" value="${key}"><button name="choice" value="approve" class="btn btn-success">Verify</button> <button name="choice" value="deny" class="btn btn-danger">Reject</button></form></div>`;
        }
    });
    res.send(`${CSS}<div class="container">${NAV('queue')}${cards || '<div class="card">The queue is silent.</div>'}</div>`);
});

app.post('/decide', async (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    const { token, choice } = req.body;
    const data = pendingVerifications.get(token);
    if (!data) return res.redirect('/admin-review');
    
    const user = await client.users.fetch(data.userId).catch(() => null);

    if (choice === 'approve') {
        let v = getJSON(verifiedUsersFile);
        if (!v.includes(data.userId)) { v.push(data.userId); saveJSON(verifiedUsersFile, v); }
        const s = getJSON(settingsFile)[data.guildId] || {};
        if (s.roleId) {
            const guild = await client.guilds.fetch(data.guildId);
            const member = await guild.members.fetch(data.userId).catch(() => null);
            if (member) await member.roles.add(s.roleId).catch(() => null);
        }
        if (user) await user.send("✅ **The Council has approved your identity.** Passage is granted.").catch(() => null);
    } else {
        if (user) await user.send("❌ **The Council has rejected your identity.** Please ensure your credentials are clear and try again.").catch(() => null);
    }

    if (data.filename) fs.unlinkSync(path.join(uploadDir, data.filename));
    pendingVerifications.delete(token);
    recordStat(req.session.adminId, choice);
    res.redirect('/admin-review');
});

app.get('/admin-users', (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    const vList = getJSON(verifiedUsersFile);
    const bList = getJSON(blacklistFile);
    const vRows = vList.map(id => `<tr class="user-row" data-id="${id}"><td><code>${id}</code></td><td><form action="/unverify" method="POST"><input type="hidden" name="userId" value="${id}"><button class="btn btn-danger" style="padding:5px 10px;">Revoke & Strip</button></form></td></tr>`).join('');
    const bRows = bList.map(id => `<tr class="user-row" data-id="${id}"><td><code>${id}</code></td><td><form action="/unblacklist" method="POST"><input type="hidden" name="userId" value="${id}"><button class="btn btn-success" style="padding:5px 10px;">Forgive</button></form></td></tr>`).join('');

    res.send(`${CSS}<div class="container">${NAV('users')}
        <div class="card"><h2>Live Search</h2><input type="text" id="searchInput" class="search-input" placeholder="User ID..." onkeyup="filterUsers()"></div>
        <div class="card"><h2>Manual Action</h2><form action="/manual-action" method="POST" style="display:flex; gap:10px;"><input type="text" name="targetId" placeholder="User ID..." required style="flex:1;"><button name="action" value="verify" class="btn btn-success">Verify</button> <button name="action" value="blacklist" class="btn btn-danger">Exile</button></form></div>
        <div class="card"><h2>Verified</h2><table><tbody id="vTable">${vRows || '<tr><td>None</td></tr>'}</tbody></table></div>
        <div class="card"><h2>Blacklist</h2><table><tbody id="bTable">${bRows || '<tr><td>None</td></tr>'}</tbody></table></div>
        <script>function filterUsers(){const q=document.getElementById('searchInput').value.toLowerCase(); document.querySelectorAll('.user-row').forEach(r=>r.style.display=r.dataset.id.includes(q)?'':'none');}</script>
    </div>`);
});

app.post('/unverify', async (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    saveJSON(verifiedUsersFile, getJSON(verifiedUsersFile).filter(id => id !== req.body.userId));
    await revokeGlobalRoles(req.body.userId);
    res.redirect('/admin-users');
});

app.post('/manual-action', async (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    const { targetId, action } = req.body;
    if (action === 'verify') {
        let v = getJSON(verifiedUsersFile);
        if (!v.includes(targetId)) { v.push(targetId); saveJSON(verifiedUsersFile, v); }
    } else {
        let b = getJSON(blacklistFile);
        if (!b.includes(targetId)) { b.push(targetId); saveJSON(blacklistFile, b); }
        saveJSON(verifiedUsersFile, getJSON(verifiedUsersFile).filter(id => id !== targetId));
        await revokeGlobalRoles(targetId);
    }
    res.redirect('/admin-users');
});

app.get('/admin-servers', (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    let cards = client.guilds.cache.map(g => {
        const s = getJSON(settingsFile)[g.id] || {};
        const role = s.roleId ? g.roles.cache.get(s.roleId) : null;
        return `<div class="card"><h3>${g.name}</h3><p>Role: <b style="color:var(--elven-gold)">${role ? role.name : 'Unset'}</b></p></div>`;
    }).join('');
    res.send(`${CSS}<div class="container">${NAV('servers')}${cards}</div>`);
});

app.get('/admin-stats', (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    const stats = getJSON(statsFile, {});
    let rows = Object.entries(stats).map(([id, d]) => `<tr><td><code>${id}</code></td><td>${d.approvals}</td><td>${d.denials}</td></tr>`).join('');
    res.send(`${CSS}<div class="container">${NAV('stats')}<div class="card"><table><thead><tr><th>Admin</th><th>Approve</th><th>Deny</th></tr></thead><tbody>${rows}</tbody></table></div></div>`);
});

// --- DISCORD COMMANDS ---
client.on('ready', async () => {
    const cmds = [
        new SlashCommandBuilder().setName('verify').setDescription('Begin your verification process.'),
        new SlashCommandBuilder().setName('setrole').setDescription('Configure the verified role.').addRoleOption(o => o.setName('role').setDescription('The role').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    ];
    await new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN).put(Routes.applicationCommands(process.env.CLIENT_ID), { body: cmds });
});

client.on('interactionCreate', async (i) => {
    if (!i.isChatInputCommand()) return;
    if (i.commandName === 'setrole') {
        let s = getJSON(settingsFile, {}); s[i.guildId] = { roleId: i.options.getRole('role').id }; saveJSON(settingsFile, s);
        i.reply({ content: '✅ Role updated.', ephemeral: true });
    }
    if (i.commandName === 'verify') {
        if (isBlacklisted(i.user.id)) return i.reply({ content: '❌ You are exiled.', ephemeral: true });
        if (isGloballyVerified(i.user.id)) {
            const s = getJSON(settingsFile)[i.guildId] || {};
            if (s.roleId) await i.member.roles.add(s.roleId).catch(() => null);
            return i.reply({ content: '✅ Already verified.', ephemeral: true });
        }
        const t = uuidv4();
        pendingVerifications.set(t, { userId: i.user.id, guildId: i.guildId, status: 'awaiting_upload' });
        const dm = await i.user.send(`🛡️ **Identity Portal**: ${process.env.BASE_URL}/verify/${t}`).catch(() => null);
        i.reply({ content: dm ? 'Check DMs.' : '❌ Enable DMs.', ephemeral: true });
    }
});

// --- PUBLIC ROUTES ---
app.get('/verify/:token', (req, res) => {
    const d = pendingVerifications.get(req.params.token);
    if (!d || isBlacklisted(d.userId)) return res.send("Link invalid.");
    res.send(`${CSS}<div class="card" style="text-align:center;"><h2>Upload Credentials</h2><form action="/upload" method="POST" enctype="multipart/form-data"><input type="hidden" name="token" value="${req.params.token}"><input type="file" name="idImage" required><br><br><button class="btn">Submit</button></form></div>`);
});

app.post('/upload', upload.single('idImage'), (req, res) => {
    const d = pendingVerifications.get(req.body.token);
    if (!d) return res.send("Expired.");
    d.filename = req.file.filename; d.status = 'pending_review';
    res.send("Received. The Council is deliberating.");
});

app.get('/view-id/:f', (req, res) => { if (req.session.authenticated) res.sendFile(path.join(uploadDir, req.params.f)); });
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.listen(process.env.PORT || 3000);
client.login(process.env.DISCORD_TOKEN);