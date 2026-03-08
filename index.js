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
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const app = express();
const upload = multer({ dest: 'uploads/' });
const pendingVerifications = new Map();

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages] 
});

// --- MODERN CSS ---
const CSS = `<style>
    :root { --blurple: #5865F2; --bg-dark: #36393f; --bg-card: #2f3136; --text: #ffffff; --muted: #b9bbbe; --danger: #ed4245; --success: #3ba55c; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: var(--bg-dark); color: var(--text); margin: 0; display: flex; flex-direction: column; align-items: center; min-height: 100vh; padding: 20px; }
    .container { width: 100%; max-width: 800px; }
    .card { background: var(--bg-card); padding: 30px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); text-align: center; margin-bottom: 20px; border: 1px solid rgba(255,255,255,0.05); }
    .btn { background: var(--blurple); color: white; border: none; padding: 12px 20px; border-radius: 4px; font-weight: bold; cursor: pointer; text-decoration: none; display: inline-block; transition: 0.2s; }
    .btn:hover { background: #4752C4; }
    .btn-danger { background: var(--danger); }
    .nav { margin-bottom: 20px; display: flex; gap: 15px; justify-content: center; }
    .nav a { color: var(--muted); text-decoration: none; font-weight: bold; }
    .nav a.active { color: var(--text); border-bottom: 2px solid var(--blurple); }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; background: #202225; border-radius: 8px; overflow: hidden; }
    th, td { padding: 15px; text-align: left; border-bottom: 1px solid #40444B; }
    .badge { padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; text-transform: uppercase; }
    .badge-success { background: var(--success); }
    .badge-danger { background: var(--danger); }
    .preview-img { width: 100%; border-radius: 4px; margin: 15px 0; border: 2px solid #000; }
    .tos-box { background: #202225; padding: 15px; border-radius: 6px; text-align: left; font-size: 13px; margin-bottom: 15px; border-left: 4px solid var(--blurple); }
</style>`;

// --- DATABASE HELPERS ---
function getGuildSettings(guildId) {
    if (!fs.existsSync(settingsFile)) return {};
    return JSON.parse(fs.readFileSync(settingsFile))[guildId] || {};
}
function saveGuildSetting(guildId, roleId) {
    let s = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile)) : {};
    s[guildId] = { roleId };
    fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2));
}
function recordStat(adminId, action) {
    let s = fs.existsSync(statsFile) ? JSON.parse(fs.readFileSync(statsFile)) : {};
    if (!s[adminId]) s[adminId] = { approvals: 0, denials: 0 };
    action === 'approve' ? s[adminId].approvals++ : s[adminId].denials++;
    fs.writeFileSync(statsFile, JSON.stringify(s, null, 2));
}

app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false, saveUninitialized: false,
    cookie: { secure: false } 
}));

// --- OAUTH2 & PUBLIC ROUTES ---

app.get('/', (req, res) => {
    res.send(`${CSS}<div class="container"><div class="card"><h1>🛡️ Verification Hub</h1><p>Secure Staff Management Portal</p><br><a href="/auth/discord" class="btn">Login with Discord</a></div></div>`);
});

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

        const userResp = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenResp.data.access_token}` }
        });

        const staffGuild = await client.guilds.fetch(process.env.STAFF_GUILD_ID);
        const member = await staffGuild.members.fetch(userResp.data.id);

        if (member.roles.cache.has(process.env.STAFF_ROLE_ID)) {
            req.session.authenticated = true;
            req.session.adminUser = userResp.data.id;
            return res.redirect('/admin-review');
        }
        res.send("Access Denied: Required Staff Role missing.");
    } catch (e) { res.send("Auth Failed: " + e.message); }
});

// --- USER UPLOAD ROUTES ---

app.get('/verify/:token', (req, res) => {
    const data = pendingVerifications.get(req.params.token);
    if (!data) return res.send(`${CSS}<div class="container"><div class="card"><h2>Link Expired</h2><p>Please run /verify again.</p></div></div>`);
    res.send(`${CSS}<div class="container"><div class="card"><h2>ID Verification</h2><p>Please upload a clear photo of your ID.</p><form action="/upload" method="POST" enctype="multipart/form-data"><input type="hidden" name="token" value="${req.params.token}"><input type="file" name="idImage" accept="image/*" required><div class="tos-box"><strong>🔒 Privacy Notice</strong><br>Your ID is deleted immediately after review. Only staff see this submission.</div><div style="margin-bottom:15px;"><input type="checkbox" id="tos" required> <label for="tos">I agree to the Terms of Service.</label></div><button class="btn" style="width:100%">Submit for Review</button></form></div></div>`);
});

app.post('/upload', upload.single('idImage'), async (req, res) => {
    const data = pendingVerifications.get(req.body.token);
    if (!data || !req.file) return res.status(400).send("Upload Failed.");
    data.filename = req.file.filename;
    data.status = 'pending_review';

    try {
        const log = await client.channels.fetch(process.env.STAFF_LOG_CHANNEL_ID);
        await log.send({ embeds: [new EmbedBuilder().setTitle('📸 ID Uploaded').setColor(0x5865F2).setDescription(`User <@${data.userId}> has submitted an ID for review.`).setTimestamp()] });
    } catch(e) {}
    res.send(`${CSS}<div class="container"><div class="card"><h2>Success!</h2><p>Your ID has been submitted. Staff will review it shortly.</p></div></div>`);
});

// --- ADMIN DASHBOARD ---

app.get('/admin-review', (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    let cards = '';
    pendingVerifications.forEach((val, key) => {
        if (val.status === 'pending_review') {
            const guild = client.guilds.cache.get(val.guildId);
            cards += `<div class="card" style="text-align:left;"><h3>${guild?.name || 'Server'}</h3><p>User: <@${val.userId}></p><img src="/view-id/${val.filename}" class="preview-img"><form action="/decide" method="POST" style="display:flex; gap:10px;"><input type="hidden" name="token" value="${key}"><button name="choice" value="approve" class="btn" style="flex:1">Approve</button><button name="choice" value="deny" class="btn btn-danger" style="flex:1">Deny</button></form></div>`;
        }
    });
    res.send(`${CSS}<div class="container"><div class="nav"><a href="/admin-review" class="active">Queue</a><a href="/admin-servers">Servers</a><a href="/admin-stats">Stats</a><a href="/logout">Logout</a></div>${cards || '<div class="card"><h3>Queue Clear</h3></div>'}</div>`);
});

app.use('/view-id', (req, res, next) => {
    if (!req.session.authenticated) return res.status(403).send("Forbidden");
    next();
}, express.static(uploadDir));

app.post('/decide', async (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    const { token, choice } = req.body;
    const data = pendingVerifications.get(token);
    if (!data) return res.redirect('/admin-review');

    try {
        const guild = await client.guilds.fetch(data.guildId);
        const member = await guild.members.fetch(data.userId);
        const settings = getGuildSettings(data.guildId);
        const role = settings.roleId ? await guild.roles.fetch(settings.roleId) : guild.roles.cache.find(r => r.name.toLowerCase() === "verified");

        if (choice === 'approve' && role) {
            await member.roles.add(role);
            await member.send(`✅ Verification approved in **${guild.name}**!`);
        } else {
            await member.send(`❌ Verification denied in **${guild.name}**.`);
        }
        recordStat(req.session.adminUser, choice);
    } catch (e) { console.error(e); }

    if (data.filename) fs.unlinkSync(path.join(uploadDir, data.filename));
    pendingVerifications.delete(token);
    res.redirect('/admin-review');
});

app.get('/admin-servers', (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    let rows = '';
    client.guilds.cache.forEach(g => {
        const s = getGuildSettings(g.id);
        const role = s.roleId ? `<span class="badge badge-success">Custom</span>` : (g.roles.cache.find(r => r.name.toLowerCase() === "verified") ? `<span class="badge" style="background:#4f545c">Default</span>` : `<span class="badge badge-danger">Missing</span>`);
        rows += `<tr><td>${g.name}</td><td>${role}</td><td>${g.memberCount}</td></tr>`;
    });
    res.send(`${CSS}<div class="container"><div class="nav"><a href="/admin-review">Queue</a><a href="/admin-servers" class="active">Servers</a><a href="/admin-stats">Stats</a><a href="/logout">Logout</a></div><div class="card"><table><thead><tr><th>Server</th><th>Role Status</th><th>Members</th></tr></thead><tbody>${rows}</tbody></table></div></div>`);
});

app.get('/admin-stats', (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    const stats = fs.existsSync(statsFile) ? JSON.parse(fs.readFileSync(statsFile)) : {};
    let rows = '';
    Object.entries(stats).forEach(([id, s]) => { rows += `<tr><td><@${id}></td><td>${s.approvals}</td><td>${s.denials}</td></tr>`; });
    res.send(`${CSS}<div class="container"><div class="nav"><a href="/admin-review">Queue</a><a href="/admin-servers">Servers</a><a href="/admin-stats" class="active">Stats</a><a href="/logout">Logout</a></div><div class="card"><table><tr><th>Staff</th><th>✅ OK</th><th>❌ NO</th></tr>${rows}</table></div></div>`);
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- DISCORD COMMANDS ---
client.on('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const commands = [
        new SlashCommandBuilder().setName('verify').setDescription('Start your verification.'),
        new SlashCommandBuilder().setName('setrole').setDescription('Set target role.').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    ].map(c => c.toJSON());
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
});

client.on('interactionCreate', async (i) => {
    if (!i.isChatInputCommand()) return;
    if (i.commandName === 'setrole') {
        saveGuildSetting(i.guildId, i.options.getRole('role').id);
        return i.reply({ content: '✅ Role updated!', ephemeral: true });
    }
    if (i.commandName === 'verify') {
        const token = uuidv4();
        pendingVerifications.set(token, { userId: i.user.id, guildId: i.guildId, status: 'awaiting_upload', timestamp: Date.now() });
        await i.reply({ content: 'Check DMs!', ephemeral: true });
        try { 
            await i.user.send(`🛡️ Verify for **${i.guild.name}**: ${process.env.BASE_URL}/verify/${token}`); 
            const log = await client.channels.fetch(process.env.STAFF_LOG_CHANNEL_ID);
            await log.send({ embeds: [new EmbedBuilder().setTitle('📥 Verification Started').setDescription(`User <@${i.user.id}> started verification.`).setTimestamp()] });
        } catch (e) { await i.followUp({ content: 'Open DMs!', ephemeral: true }); }
    }
});

app.listen(process.env.PORT, () => console.log(`Portal online at ${process.env.BASE_URL}`));
client.login(process.env.DISCORD_TOKEN);