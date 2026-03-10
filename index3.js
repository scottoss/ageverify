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

// --- MODERN FANTASY UI ENGINE ---
const CSS = `<style>
    @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Inter:wght@300;400;600&display=swap');
    
    :root { 
        --obsidian-bg: #0f1115; 
        --parchment-text: #e2e8f0; 
        --arcane-glow: #8b5cf6; 
        --elven-gold: #fbbf24; 
        --void-surface: rgba(30, 32, 40, 0.7); 
        --danger: #ef4444;
        --success: #10b981;
        --font-heading: 'Cinzel', serif; 
        --font-body: 'Inter', sans-serif; 
        --glass-blur: blur(12px); 
        --magic-shadow: 0 4px 20px rgba(139, 92, 246, 0.15); 
        --gold-border: 1px solid rgba(251, 191, 36, 0.3); 
    }
    
    body { font-family: var(--font-body); background-color: var(--obsidian-bg); background-image: radial-gradient(circle at top right, rgba(139, 92, 246, 0.1), transparent 40%); color: var(--parchment-text); margin: 0; display: flex; flex-direction: column; align-items: center; min-height: 100vh; padding: 20px; }
    h1, h2, h3 { font-family: var(--font-heading); color: var(--elven-gold); text-shadow: 0 2px 10px rgba(251, 191, 36, 0.2); letter-spacing: 1px; margin-top: 0; }
    
    .container { width: 100%; max-width: 1100px; }
    
    .card { background: var(--void-surface); backdrop-filter: var(--glass-blur); border: var(--gold-border); border-radius: 12px; padding: 25px; box-shadow: var(--magic-shadow); text-align: center; margin-bottom: 20px; transition: transform 0.3s ease; }
    
    .btn { background: linear-gradient(135deg, #6d28d9 0%, #4c1d95 100%); color: white; font-family: var(--font-heading); font-weight: bold; border: 1px solid var(--arcane-glow); padding: 10px 18px; border-radius: 6px; cursor: pointer; text-decoration: none; display: inline-block; transition: all 0.3s ease; box-shadow: 0 0 10px rgba(139, 92, 246, 0.4); }
    .btn:hover { background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); box-shadow: 0 0 20px rgba(139, 92, 246, 0.8); transform: scale(1.02); }
    
    .btn-danger { background: linear-gradient(135deg, #991b1b 0%, #7f1d1d 100%); border-color: var(--danger); box-shadow: 0 0 10px rgba(239, 68, 68, 0.4); }
    .btn-danger:hover { background: linear-gradient(135deg, #b91c1c 0%, #991b1b 100%); box-shadow: 0 0 20px rgba(239, 68, 68, 0.8); }
    
    .btn-success { background: linear-gradient(135deg, #065f46 0%, #064e3b 100%); border-color: var(--success); box-shadow: 0 0 10px rgba(16, 185, 129, 0.4); }
    .btn-success:hover { background: linear-gradient(135deg, #059669 0%, #065f46 100%); box-shadow: 0 0 20px rgba(16, 185, 129, 0.8); }
    
    .nav { margin-bottom: 30px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; background: rgba(0,0,0,0.4); padding: 15px; border-radius: 8px; border: var(--gold-border); }
    .nav a { color: var(--parchment-text); text-decoration: none; font-family: var(--font-heading); padding: 8px 15px; border-radius: 4px; transition: 0.3s; }
    .nav a:hover { background: rgba(139, 92, 246, 0.2); color: var(--elven-gold); }
    .nav a.active { background: rgba(139, 92, 246, 0.4); color: var(--elven-gold); border-bottom: 2px solid var(--elven-gold); }
    
    table { width: 100%; border-collapse: collapse; margin-top: 10px; background: rgba(0,0,0,0.5); border-radius: 8px; overflow: hidden; }
    th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid rgba(139, 92, 246, 0.2); color: var(--parchment-text); }
    th { font-family: var(--font-heading); color: var(--elven-gold); }
    
    .preview-img { width: 100%; max-height: 450px; object-fit: contain; border-radius: 8px; margin: 15px 0; border: 2px solid var(--arcane-glow); }
    code { background: rgba(0,0,0,0.8); padding: 2px 5px; border-radius: 3px; font-family: monospace; color: var(--elven-gold); }
    
    .mystic-input { width: 100%; padding: 0.75rem; background: rgba(0, 0, 0, 0.5); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 4px; color: var(--parchment-text); font-family: var(--font-body); box-sizing: border-box; }
    .mystic-input:focus { outline: none; border-color: var(--arcane-glow); box-shadow: inset 0 0 10px rgba(139, 92, 246, 0.2); }
</style>`;

const NAV = (active) => `<div class="nav">
    <a href="/admin-review" class="${active==='queue'?'active':''}">Review Queue</a>
    <a href="/admin-users" class="${active==='users'?'active':''}">Verified Entities</a>
    <a href="/admin-servers" class="${active==='servers'?'active':''}">Connected Realms</a>
    <a href="/admin-appeals" class="${active==='appeals'?'active':''}">Appeals</a>
    <a href="/admin-stats" class="${active==='stats'?'active':''}">Council Stats</a>
    <a href="/logout">Depart</a>
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
            .setTitle(`📑 Archive Log: ${action.replace('_', ' ').toUpperCase()}`)
            .setColor(colors[action] || 0x5865F2)
            .addFields(
                { name: "Council Member", value: `<@${adminId}>`, inline: true },
                { name: "Subject", value: `<@${userId}>`, inline: true },
                { name: "Realm", value: guildName, inline: true }
            ).setTimestamp();
        await logChannel.send({ embeds: [embed] });
    } catch (e) { console.error("Log Error:", e.message); }
}

app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET || 'mystic_secret_123', resave: false, saveUninitialized: false, cookie: { secure: false } }));

// --- AUTH ---
app.get('/', (req, res) => res.send(`${CSS}<div class="container"><div class="card"><h1>🛡️ Portal of Truth</h1><p>Only authorized entities may enter.</p><br><a href="/auth/discord" class="btn">Authenticate via Discord</a></div></div>`));

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
        res.send(`${CSS}<div class="card"><h2>Access Denied</h2><p>You do not possess the necessary seals to view the archives.</p></div>`);
    } catch (e) { res.send(`${CSS}<div class="card"><h2>Mystic Interference</h2><p>${e.message}</p></div>`); }
});

// --- ADMIN PAGES ---

app.get('/admin-review', (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    let cards = '';
    pendingVerifications.forEach((val, key) => {
        if (val.status === 'pending_review') {
            const user = client.users.cache.get(val.userId);
            cards += `<div class="card" style="text-align:left;"><h3>Entity: ${user?`@${user.tag}`:'Unknown'} <small style="color:var(--parchment-text);font-family:var(--font-body);">(${val.userId})</small></h3><img src="/view-id/${val.filename}" class="preview-img"><form action="/decide" method="POST" style="display:flex; gap:10px;"><input type="hidden" name="token" value="${key}"><button name="choice" value="approve" class="btn btn-success">Verify Identity</button><button name="choice" value="deny" class="btn btn-danger">Reject</button></form></div>`;
        }
    });
    res.send(`${CSS}<div class="container">${NAV('queue')}${cards || '<div class="card"><h3>The queue is silent. No travelers await.</h3></div>'}</div>`);
});

app.get('/admin-users', (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    const v = getJSON(verifiedUsersFile);
    let rows = v.map(id => {
        const user = client.users.cache.get(id);
        const tag = user ? `@${user.tag}` : 'Unknown';
        return `<tr class="user-row" data-id="${id}" data-tag="${tag.toLowerCase()}"><td><code>${id}</code></td><td><strong>${tag}</strong></td><td><form action="/unverify" method="POST" style="margin:0; display:flex; align-items:center; gap:10px;"><input type="hidden" name="userId" value="${id}"><label style="cursor:pointer;"><input type="checkbox" name="ban" value="true"> Exile (Ban)</label> <button class="btn btn-danger" style="padding:6px 12px; font-size:12px;">Revoke Status</button></form></td></tr>`;
    }).join('');
    res.send(`${CSS}<div class="container">${NAV('users')}
        <div class="card" style="text-align:left; border-left:4px solid var(--success);"><h3>✨ Manual Whitelist</h3><form action="/manual-verify" method="POST" style="display:flex; gap:10px;"><input type="text" name="userId" class="mystic-input" placeholder="Entity ID..." required style="flex:1;"><button class="btn btn-success">Grant Access</button></form></div>
        <div class="card"><input type="text" id="s" class="mystic-input" placeholder="Search the archives..." style="margin-bottom:15px;"><table><thead><tr><th>ID</th><th>Entity</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div></div>
        <script>document.getElementById('s').onkeyup=function(){let v=this.value.toLowerCase(); document.querySelectorAll('.user-row').forEach(r=>r.style.display=(r.dataset.id.includes(v)||r.dataset.tag.includes(v))?'':'none')}</script>`);
});

app.get('/admin-servers', (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    let cards = client.guilds.cache.map(guild => {
        const s = getGuildSettings(guild.id);
        const activeRole = s.roleId ? guild.roles.cache.get(s.roleId) : guild.roles.cache.find(r => r.name.toLowerCase() === "verified");
        const vCount = guild.members.cache.filter(m => activeRole && m.roles.cache.has(activeRole.id)).size;
        return `<div class="card" style="flex:1; min-width:300px; text-align:left;"><h2>${guild.name}</h2><p>Realm ID: <code>${guild.id}</code></p><div style="background:rgba(0,0,0,0.5); padding:10px; border-radius:4px; margin-bottom:10px;"><strong>Granted Role:</strong> ${activeRole?activeRole.name:'<span style="color:var(--danger)">NOT CONFIGURED</span>'}</div><p>Verified Souls: <b>${vCount}</b> / Total: ${guild.memberCount}</p></div>`;
    }).join('');
    res.send(`${CSS}<div class="container">${NAV('servers')}<div style="display:flex; flex-wrap:wrap; gap:20px;">${cards}</div></div>`);
});

app.get('/admin-stats', (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    const stats = getJSON(statsFile, {});
    let rows = Object.entries(stats).map(([id, d]) => {
        const user = client.users.cache.get(id);
        return `<tr><td>${user?`@${user.tag}`:id}</td><td>${d.approvals}</td><td>${d.denials}</td><td>${d.approvals+d.denials}</td></tr>`;
    }).join('');
    res.send(`${CSS}<div class="container">${NAV('stats')}<div class="card"><table><thead><tr><th>Council Member</th><th>Approvals</th><th>Rejections</th><th>Total Judgments</th></tr></thead><tbody>${rows}</tbody></table></div></div>`);
});

app.get('/admin-appeals', (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    const appeals = getJSON(appealsFile, {});
    let cards = Object.entries(appeals).map(([id, d]) => {
        const user = client.users.cache.get(id);
        return `<div class="card" style="text-align:left;"><h3>Appeal: ${user?`@${user.tag}`:id}</h3><p style="background:rgba(0,0,0,0.5); padding:15px; border-radius:6px; border-left: 3px solid var(--elven-gold);"><i>"${d.reason}"</i></p><form action="/decide-appeal" method="POST" style="display:flex; gap:10px; margin-top:15px;"><input type="hidden" name="userId" value="${id}"><button name="choice" value="pardon" class="btn btn-success">Pardon Entity</button><button name="choice" value="reject" class="btn btn-danger">Uphold Exile</button></form></div>`;
    }).join('');
    res.send(`${CSS}<div class="container">${NAV('appeals')}${cards || '<div class="card"><h3>No pleas for forgiveness.</h3></div>'}</div>`);
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
            if (choice === 'approve') {
                let v = getJSON(verifiedUsersFile); if (!v.includes(data.userId)) { v.push(data.userId); saveJSON(verifiedUsersFile, v); }
                await member.send(`✅ You have been verified and granted passage.`).catch(() => null);
				await member.roles.add(role);
            } else { await member.send(`❌ Your verification was rejected by the council.`).catch(() => null); }
        }
        await sendAuditLog(req.session.adminUser, data.userId, guild.name, choice);
        recordStat(req.session.adminUser, choice);
    } catch (e) {}
    if (data.filename && fs.existsSync(path.join(uploadDir, data.filename))) {
        fs.unlinkSync(path.join(uploadDir, data.filename));
    }
    pendingVerifications.delete(token);
    res.redirect('/admin-review');
});

app.post('/decide-appeal', async (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    
    const { userId, choice } = req.body;
    
    // 1. Remove the user from the active appeals list
    let appeals = getJSON(appealsFile, {});
    delete appeals[userId];
    saveJSON(appealsFile, appeals);

    if (choice === 'pardon') {
        // 2. Remove from the blacklist
        let blacklist = getJSON(blacklistFile);
        blacklist = blacklist.filter(id => id !== userId);
        saveJSON(blacklistFile, blacklist);
        
        // 3. Log it and notify the user
        await sendAuditLog(req.session.adminUser, userId, "GLOBAL", "PARDONED");
        const u = await client.users.fetch(userId).catch(() => null);
        if (u) await u.send("✨ The council has pardoned your past transgressions. You may now attempt to verify your identity again.").catch(() => null);
    } else {
        // Just log the rejection (they remain on the blacklist)
        await sendAuditLog(req.session.adminUser, userId, "GLOBAL", "deny");
    }

    // 4. Send the admin back to the appeals page
    res.redirect('/admin-appeals');
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
        if (u) await u.send("✅ You have been manually whitelisted by the council.").catch(() => null);
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
        new SlashCommandBuilder().setName('verify').setDescription('Present your credentials to the portal.'),
        new SlashCommandBuilder().setName('setrole').setDescription('Configure the mystic seal (role) for verified travelers.').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    ];
    await new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN).put(Routes.applicationCommands(process.env.CLIENT_ID), { body: cmds });
});

client.on('interactionCreate', async (i) => {
    if (!i.isChatInputCommand()) return;
    if (i.commandName === 'setrole') {
        let s = getJSON(settingsFile, {}); s[i.guildId] = { roleId: i.options.getRole('role').id }; saveJSON(settingsFile, s);
        return i.reply({ content: '✅ The mystic seal has been updated.', ephemeral: true });
    }
    if (i.commandName === 'verify') {
        if (isBlacklisted(i.user.id)) {
            const t = uuidv4(); pendingVerifications.set(t, { userId: i.user.id, status: 'awaiting_appeal', timestamp: Date.now() });
            return i.reply({ content: `❌ You have been exiled from the realm. Appeal your ban here: ${process.env.BASE_URL}/appeal/${t}`, ephemeral: true });
        }
        if (isGloballyVerified(i.user.id)) {
            const s = getGuildSettings(i.guildId);
            const r = s.roleId ? await i.guild.roles.fetch(s.roleId) : i.guild.roles.cache.find(ro => ro.name.toLowerCase() === "verified");
            if (r) { await i.member.roles.add(r); return i.reply({ content: '✅ Your past credentials are recognized. Passage granted.', ephemeral: true }); } else { return i.reply({ content: '✅ Your past credentials are recognized. || ❌ Error: This server has no set verified role, please notify a server admin to fix this using the /setrole command.', ephemeral: true });
			}
        }
        const t = uuidv4(); pendingVerifications.set(t, { userId: i.user.id, guildId: i.guildId, status: 'awaiting_upload', timestamp: Date.now() });
        await i.reply({ content: 'Look to your direct messages for the portal link.', ephemeral: true });
        try { await i.user.send(`🛡️ Present your identification here: ${process.env.BASE_URL}/verify/${t}`); } catch { await i.followUp({ content: 'You must allow direct messages from travelers of this server to receive the link.', ephemeral: true }); }
    }
});

// --- BOOT ---
app.get('/view-id/:f', (req, res) => { if (req.session.authenticated) res.sendFile(path.join(uploadDir, req.params.f)); });
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// USER-FACING PORTALS WITH STRICT BLACKLIST PROTECTION
app.get('/verify/:token', (req, res) => { 
    const d = pendingVerifications.get(req.params.token);
    if (!d) return res.send(`${CSS}<div class="container"><div class="card"><h2>The portal has faded.</h2><p>This link is expired or invalid.</p></div></div>`);
    
    if (isBlacklisted(d.userId)) {
        return res.send(`${CSS}<div class="container"><div class="card"><h2>Access Denied</h2><p>You have been eternally exiled from this system. You may not present new credentials.</p></div></div>`);
    }

    res.send(`${CSS}<div class="container"><div class="card"><h2>Present Identification</h2><p>Upload a clear image of your credentials to gain passage.</p><form action="/upload" method="POST" enctype="multipart/form-data"><input type="hidden" name="token" value="${req.params.token}"><input type="file" name="idImage" class="mystic-input" style="margin-bottom:15px; background:rgba(0,0,0,0.2); border: 1px dashed var(--arcane-glow);" required><br><button class="btn">Submit to the Council</button></form></div></div>`); 
});

app.post('/upload', upload.single('idImage'), (req, res) => { 
    const d = pendingVerifications.get(req.body.token); 
    if (!d) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.send(`${CSS}<div class="container"><div class="card"><h2>Error</h2><p>Invalid session token.</p></div></div>`);
    }

    // STRICT BLACKLIST ENFORCEMENT ON UPLOAD
    if (isBlacklisted(d.userId)) {
        if (req.file) fs.unlinkSync(req.file.path); // Destroy the uploaded file immediately
        return res.send(`${CSS}<div class="container"><div class="card"><h2>Access Denied</h2><p>Exiled entities are barred from interacting with the archives.</p></div></div>`);
    }

    d.filename = req.file.filename; 
    d.status = 'pending_review'; 
    res.send(`${CSS}<div class="container"><div class="card"><h2>Credentials Received</h2><p>The council is currently reviewing your identity. You will be notified shortly.</p></div></div>`); 
});

app.get('/appeal/:t', (req, res) => { 
    res.send(`${CSS}<div class="container"><div class="card"><h2>Appeal Your Exile</h2><p>State your reasoning for returning to the realm.</p><form action="/submit-appeal" method="POST"><input type="hidden" name="token" value="${req.params.t}"><textarea name="reason" class="mystic-input" placeholder="Enter your plea..." rows="5" style="margin-bottom:15px;" required></textarea><br><button class="btn">Send Plea</button></form></div></div>`); 
});

app.post('/submit-appeal', (req, res) => { 
    const d = pendingVerifications.get(req.body.token); 
    if (!d) return res.send(`${CSS}<div class="container"><div class="card"><h2>Error</h2><p>Invalid appeal token.</p></div></div>`);
    let a = getJSON(appealsFile, {}); 
    a[d.userId] = { reason: req.body.reason, timestamp: Date.now() }; 
    saveJSON(appealsFile, a); 
    res.send(`${CSS}<div class="container"><div class="card"><h2>Plea Submitted</h2><p>Your words have been sent to the council. Await their judgment.</p></div></div>`); 
});

app.listen(process.env.PORT || 3000, () => console.log("Mystic Gateway System Online."));
client.login(process.env.DISCORD_TOKEN);