require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
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
const appealsFile = path.join(__dirname, 'appeals.json');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const app = express();
const upload = multer({ dest: 'uploads/' });
const pendingVerifications = new Map();

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.DirectMessages
    ] 
});

// --- MODERN UI ENGINE ---
const CSS = `<style>
    :root { --blurple: #5865F2; --bg-dark: #36393f; --bg-card: #2f3136; --text: #ffffff; --muted: #b9bbbe; --danger: #ed4245; --success: #3ba55c; --warning: #faa61a; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: var(--bg-dark); color: var(--text); margin: 0; display: flex; flex-direction: column; align-items: center; min-height: 100vh; padding: 20px; }
    .container { width: 100%; max-width: 1100px; }
    .card { background: var(--bg-card); padding: 25px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); text-align: center; margin-bottom: 20px; border: 1px solid rgba(255,255,255,0.05); }
    .btn { background: var(--blurple); color: white; border: none; padding: 10px 18px; border-radius: 4px; font-weight: bold; cursor: pointer; text-decoration: none; display: inline-block; transition: 0.2s; }
    .btn:hover { opacity: 0.8; }
    .btn-danger { background: var(--danger); }
    .btn-success { background: var(--success); }
    .nav { margin-bottom: 30px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; background: #2f3136; padding: 15px; border-radius: 8px; }
    .nav a { color: var(--muted); text-decoration: none; font-weight: bold; padding: 8px 15px; border-radius: 4px; transition: 0.3s; }
    .nav a:hover { background: rgba(255,255,255,0.05); color: #fff; }
    .nav a.active { background: var(--blurple); color: #text; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; background: #202225; border-radius: 8px; overflow: hidden; }
    th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #40444B; }
    .preview-img { width: 100%; max-height: 450px; object-fit: contain; border-radius: 4px; margin: 15px 0; border: 2px solid #000; }
    code { background: #000; padding: 2px 5px; border-radius: 3px; font-family: monospace; color: var(--warning); }
</style>`;

const NAV = (active) => `<div class="nav">
    <a href="/admin-review" class="${active==='queue'?'active':''}">Queue</a>
    <a href="/admin-users" class="${active==='users'?'active':''}">Users</a>
    <a href="/admin-servers" class="${active==='servers'?'active':''}">Servers</a>
    <a href="/admin-appeals" class="${active==='appeals'?'active':''}">Appeals</a>
    <a href="/admin-stats" class="${active==='stats'?'active':''}">Staff Stats</a>
    <a href="/logout">Logout</a>
</div>`;

// --- DATABASE HELPERS ---
const getJSON = (file, def = []) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : def;
const saveJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

function getGuildSettings(guildId) { return getJSON(settingsFile, {})[guildId] || {}; }
function isGloballyVerified(userId) { return getJSON(verifiedUsersFile).includes(userId); }
function isBlacklisted(userId) { return getJSON(blacklistFile).includes(userId); }

function recordStat(adminId, action) {
    let s = getJSON(statsFile, {});
    if (!s[adminId]) s[adminId] = { approvals: 0, denials: 0 };
    action === 'approve' ? s[adminId].approvals++ : s[adminId].denials++;
    saveJSON(statsFile, s);
}

// --- LOGGING ---
async function sendAuditLog(adminId, userId, guildName, action) {
    const channelId = process.env.STAFF_LOG_CHANNEL_ID;
    if (!channelId) return;
    try {
        const logChannel = await client.channels.fetch(channelId);
        const colors = { approve: 0x3ba55c, deny: 0xed4245, PERMANENT_BAN: 0x2f3136, PARDONED: 0xfaa61a, REVOKE: 0xe67e22, MANUAL_BYPASS: 0x5865F2 };
        const embed = new EmbedBuilder()
            .setTitle(`📑 Audit: ${action.replace('_', ' ').toUpperCase()}`)
            .setColor(colors[action] || 0x5865F2)
            .addFields(
                { name: "Staff Member", value: `<@${adminId}>`, inline: true },
                { name: "Target User", value: `<@${userId}>`, inline: true },
                { name: "Location", value: guildName, inline: true }
            ).setTimestamp();
        await logChannel.send({ embeds: [embed] });
    } catch (e) { console.error("Log Error:", e.message); }
}

app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));

// --- AUTH ---
app.get('/', (req, res) => res.send(`${CSS}<div class="container"><div class="card"><h1>🛡️ Verification Hub</h1><a href="/auth/discord" class="btn">Login with Discord</a></div></div>`));

app.get('/auth/discord', (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify%20guilds.members.read`;
    res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/');
    try {
        const tokenResp = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.CLIENT_ID, client_secret: process.env.CLIENT_SECRET,
            code, grant_type: 'authorization_code', redirect_uri: process.env.REDIRECT_URI
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const userResp = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tokenResp.data.access_token}` } });
        const staffGuild = await client.guilds.fetch(process.env.STAFF_GUILD_ID);
        const member = await staffGuild.members.fetch(userResp.data.id);

        if (member.roles.cache.has(process.env.STAFF_ROLE_ID)) {
            req.session.authenticated = true;
            req.session.adminUser = userResp.data.id;
            return res.redirect('/admin-review');
        }
        res.send("Access Denied.");
    } catch (e) { res.send("Auth Error: " + e.message); }
});

// --- ADMIN PAGES ---

// 1. QUEUE
app.get('/admin-review', (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    let cards = '';
    pendingVerifications.forEach((val, key) => {
        if (val.status === 'pending_review') {
            const user = client.users.cache.get(val.userId);
            cards += `<div class="card" style="text-align:left;"><h3>User: ${user?`@${user.tag}`:'Unknown'} <small>(${val.userId})</small></h3><img src="/view-id/${val.filename}" class="preview-img"><form action="/decide" method="POST" style="display:flex; gap:10px;"><input type="hidden" name="token" value="${key}"><button name="choice" value="approve" class="btn">Approve</button><button name="choice" value="deny" class="btn btn-danger">Deny</button></form></div>`;
        }
    });
    res.send(`${CSS}<div class="container">${NAV('queue')}${cards || '<h3>Queue Clear</h3>'}</div>`);
});

// 2. USERS
app.get('/admin-users', (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    const v = getJSON(verifiedUsersFile);
    let rows = v.map(id => {
        const user = client.users.cache.get(id);
        const tag = user ? `@${user.tag}` : 'Unknown';
        return `<tr class="user-row" data-id="${id}" data-tag="${tag.toLowerCase()}"><td><code>${id}</code></td><td><strong>${tag}</strong></td><td><form action="/unverify" method="POST" style="margin:0;"><input type="hidden" name="userId" value="${id}"><label><input type="checkbox" name="ban" value="true"> Ban</label> <button class="btn btn-danger" style="padding:4px 8px; font-size:11px;">Revoke</button></form></td></tr>`;
    }).join('');
    res.send(`${CSS}<div class="container">${NAV('users')}
        <div class="card" style="text-align:left; border-left:4px solid var(--success);"><h3>➕ Manual Whitelist</h3><form action="/manual-verify" method="POST" style="display:flex; gap:10px;"><input type="text" name="userId" placeholder="User ID..." required style="flex:1; background:#202225; color:#fff; border:1px solid #444; border-radius:4px; padding:10px;"><button class="btn btn-success">Verify</button></form></div>
        <div class="card"><input type="text" id="s" placeholder="Search..." style="width:100%; padding:10px; margin-bottom:10px; background:#202225; color:#fff; border:none; border-radius:4px;"><table><thead><tr><th>ID</th><th>User</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div></div>
        <script>document.getElementById('s').onkeyup=function(){let v=this.value.toLowerCase(); document.querySelectorAll('.user-row').forEach(r=>r.style.display=(r.dataset.id.includes(v)||r.dataset.tag.includes(v))?'':'none')}</script>`);
});

// 3. SERVERS (NETWORK MONITOR)
app.get('/admin-servers', (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    let cards = client.guilds.cache.map(guild => {
        const s = getGuildSettings(guild.id);
        const activeRole = s.roleId ? guild.roles.cache.get(s.roleId) : guild.roles.cache.find(r => r.name.toLowerCase() === "verified");
        const vCount = guild.members.cache.filter(m => activeRole && m.roles.cache.has(activeRole.id)).size;
        return `<div class="card" style="flex:1; min-width:300px; text-align:left;"><h2>${guild.name}</h2><p>ID: <code>${guild.id}</code></p><div style="background:#202225; padding:10px; border-radius:4px;"><strong>Role:</strong> ${activeRole?activeRole.name:'NOT CONFIGURED'}</div><p>Verified: <b>${vCount}</b> / Total: ${guild.memberCount}</p></div>`;
    }).join('');
    res.send(`${CSS}<div class="container">${NAV('servers')}<div style="display:flex; flex-wrap:wrap; gap:20px;">${cards}</div></div>`);
});

// 4. STATS
app.get('/admin-stats', (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    const stats = getJSON(statsFile, {});
    let rows = Object.entries(stats).map(([id, d]) => {
        const user = client.users.cache.get(id);
        return `<tr><td>${user?`@${user.tag}`:id}</td><td>${d.approvals}</td><td>${d.denials}</td><td>${d.approvals+d.denials}</td></tr>`;
    }).join('');
    res.send(`${CSS}<div class="container">${NAV('stats')}<div class="card"><table><thead><tr><th>Staff</th><th>Approvals</th><th>Denials</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table></div></div>`);
});

// 5. APPEALS
app.get('/admin-appeals', (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    const appeals = getJSON(appealsFile, {});
    let cards = Object.entries(appeals).map(([id, d]) => {
        const user = client.users.cache.get(id);
        return `<div class="card" style="text-align:left;"><h3>Appeal: ${user?`@${user.tag}`:id}</h3><p>${d.reason}</p><form action="/decide-appeal" method="POST" style="display:flex; gap:10px;"><input type="hidden" name="userId" value="${id}"><button name="choice" value="pardon" class="btn">Pardon</button><button name="choice" value="reject" class="btn btn-danger">Reject</button></form></div>`;
    }).join('');
    res.send(`${CSS}<div class="container">${NAV('appeals')}${cards || '<h3>No Appeals</h3>'}</div>`);
});

// --- CORE HANDLERS ---

app.post('/decide', async (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    const { token, choice } = req.body;
    const data = pendingVerifications.get(token);
    if (!data) return res.redirect('/admin-review');
    try {
        const guild = await client.guilds.fetch(data.guildId);
        const member = await guild.members.fetch(data.userId).catch(() => null);
        if (member) {
            const s = getGuildSettings(data.guildId);
            const role = s.roleId ? await guild.roles.fetch(s.roleId) : guild.roles.cache.find(r => r.name.toLowerCase() === "verified");
            if (choice === 'approve' && role) {
                await member.roles.add(role);
                let v = getJSON(verifiedUsersFile); if (!v.includes(data.userId)) { v.push(data.userId); saveJSON(verifiedUsersFile, v); }
                await member.send(`✅ Verified in **${guild.name}**.`).catch(() => null);
            } else { await member.send(`❌ Verification denied in **${guild.name}**.`).catch(() => null); }
        }
        await sendAuditLog(req.session.adminUser, data.userId, guild.name, choice);
        recordStat(req.session.adminUser, choice);
    } catch (e) {}
    if (data.filename) fs.unlinkSync(path.join(uploadDir, data.filename));
    pendingVerifications.delete(token);
    res.redirect('/admin-review');
});

app.post('/manual-verify', async (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    const { userId } = req.body;
    let v = getJSON(verifiedUsersFile);
    if (!v.includes(userId)) {
        v.push(userId); saveJSON(verifiedUsersFile, v);
        await sendAuditLog(req.session.adminUser, userId, "MANUAL_BYPASS", "approve");
        client.guilds.cache.forEach(async (guild) => {
            const m = await guild.members.fetch(userId).catch(() => null);
            const s = getGuildSettings(guild.id);
            const r = s.roleId ? await guild.roles.fetch(s.roleId) : guild.roles.cache.find(ro => ro.name.toLowerCase() === "verified");
            if (m && r) await m.roles.add(r).catch(() => null);
        });
        const u = await client.users.fetch(userId).catch(() => null);
        if (u) await u.send("✅ You have been manually whitelisted.").catch(() => null);
    }
    res.redirect('/admin-users');
});

app.post('/unverify', async (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    const { userId, ban } = req.body;
    saveJSON(verifiedUsersFile, getJSON(verifiedUsersFile).filter(id => id !== userId));
    if (ban === 'true') {
        let b = getJSON(blacklistFile); if (!b.includes(userId)) { b.push(userId); saveJSON(blacklistFile, b); }
        await sendAuditLog(req.session.adminUser, userId, "GLOBAL", "PERMANENT_BAN");
    }
    client.guilds.cache.forEach(async (guild) => {
        const m = await guild.members.fetch(userId).catch(() => null);
        const s = getGuildSettings(guild.id);
        const r = s.roleId ? await guild.roles.fetch(s.roleId) : guild.roles.cache.find(ro => ro.name.toLowerCase() === "verified");
        if (m && r) await m.roles.remove(r).catch(() => null);
    });
    res.redirect('/admin-users');
});

// --- DISCORD EVENTS ---
client.on('ready', async () => {
    const cmds = [
        new SlashCommandBuilder().setName('verify').setDescription('Verify your ID.'),
        new SlashCommandBuilder().setName('setrole').setDescription('Set verified role.').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    ];
    await new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN).put(Routes.applicationCommands(process.env.CLIENT_ID), { body: cmds });
});

client.on('interactionCreate', async (i) => {
    if (!i.isChatInputCommand()) return;
    if (i.commandName === 'setrole') {
        let s = getJSON(settingsFile, {}); s[i.guildId] = { roleId: i.options.getRole('role').id }; saveJSON(settingsFile, s);
        return i.reply({ content: 'Role set.', ephemeral: true });
    }
    if (i.commandName === 'verify') {
        if (isBlacklisted(i.user.id)) {
            const t = uuidv4(); pendingVerifications.set(t, { userId: i.user.id, status: 'awaiting_appeal', timestamp: Date.now() });
            return i.reply({ content: `❌ Banned. Appeal: ${process.env.BASE_URL}/appeal/${t}`, ephemeral: true });
        }
        if (isGloballyVerified(i.user.id)) {
            const s = getGuildSettings(i.guildId);
            const r = s.roleId ? await i.guild.roles.fetch(s.roleId) : i.guild.roles.cache.find(ro => ro.name.toLowerCase() === "verified");
            if (r) { await i.member.roles.add(r); return i.reply({ content: '✅ Re-synced!', ephemeral: true }); }
        }
        const t = uuidv4(); pendingVerifications.set(t, { userId: i.user.id, guildId: i.guildId, status: 'awaiting_upload', timestamp: Date.now() });
        await i.reply({ content: 'Check DMs.', ephemeral: true });
        try { await i.user.send(`🛡️ Verify: ${process.env.BASE_URL}/verify/${t}`); } catch { await i.followUp({ content: 'Enable DMs.', ephemeral: true }); }
    }
});

// --- BOOT ---
app.get('/view-id/:f', (req, res) => { if (req.session.authenticated) res.sendFile(path.join(uploadDir, req.params.f)); });
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.get('/verify/:token', (req, res) => { res.send(`${CSS}<div class="card"><form action="/upload" method="POST" enctype="multipart/form-data"><input type="hidden" name="token" value="${req.params.token}"><input type="file" name="idImage" required><button class="btn">Upload</button></form></div>`); });
app.post('/upload', upload.single('idImage'), (req, res) => { const d = pendingVerifications.get(req.body.token); d.filename = req.file.filename; d.status = 'pending_review'; res.send("Reviewing..."); });
app.get('/appeal/:t', (req, res) => { res.send(`${CSS}<form action="/submit-appeal" method="POST"><input type="hidden" name="token" value="${req.params.t}"><textarea name="reason" placeholder="Reason..."></textarea><button class="btn">Submit</button></form>`); });
app.post('/submit-appeal', (req, res) => { const d = pendingVerifications.get(req.body.token); let a = getJSON(appealsFile, {}); a[d.userId] = { reason: req.body.reason }; saveJSON(appealsFile, a); res.send("Sent."); });

app.listen(process.env.PORT, () => console.log("System Online."));
client.login(process.env.DISCORD_TOKEN);