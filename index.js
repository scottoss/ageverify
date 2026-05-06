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
const settingsFile = path.join(__dirname, 'guildSettings.json');
const verifiedUsersFile = path.join(__dirname, 'verifiedUsers.json');
const blacklistFile = path.join(__dirname, 'blacklist.json');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const app = express();
const upload = multer({ dest: 'uploads/' });
const pendingVerifications = new Map(); 

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages],
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
    .container { width: 100%; max-width: 600px; position: relative; }
    .card { background: var(--void-surface); border: 1px solid rgba(251, 191, 36, 0.3); border-radius: 12px; padding: 25px; margin-bottom: 20px; backdrop-filter: blur(10px); box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
    .btn { background: linear-gradient(135deg, #6d28d9 0%, #4c1d95 100%); color: white; padding: 12px 24px; border-radius: 6px; cursor: pointer; text-decoration: none; font-family: var(--font-heading); border:none; transition: 0.3s; width: 100%; font-size: 1rem; }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 0 15px var(--arcane-glow); }
    .nav { margin-bottom: 30px; display: flex; gap: 15px; justify-content: center; flex-wrap: wrap; background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; }
    .nav a { color: var(--parchment-text); text-decoration: none; font-family: var(--font-heading); padding: 5px 10px; font-size: 0.9rem; }
    .nav a.active { color: var(--elven-gold); border-bottom: 2px solid var(--elven-gold); }
    input[type="text"], input[type="date"] { background: rgba(0,0,0,0.5); border: 1px solid var(--arcane-glow); color: white; padding: 10px; border-radius: 4px; width: 100%; box-sizing: border-box; margin-bottom: 15px; }
    label { display: block; margin-bottom: 5px; font-family: var(--font-heading); color: var(--elven-gold); font-size: 0.8rem; }
    
    /* LOADINGRitual OVERLAY */
    #ritual-overlay { position: fixed; inset: 0; background: rgba(15, 17, 21, 0.9); backdrop-filter: blur(15px); display: none; flex-direction: column; align-items: center; justify-content: center; z-index: 1000; text-align: center; }
    .spinner { width: 60px; height: 60px; border: 4px solid rgba(139, 92, 246, 0.1); border-top: 4px solid var(--elven-gold); border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 20px; box-shadow: 0 0 20px var(--arcane-glow); }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .ritual-text { font-family: var(--font-heading); color: var(--elven-gold); font-size: 1.2rem; letter-spacing: 2px; }
</style>`;

// --- DATA HELPERS ---
const getJSON = (file, def = []) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : def;
const saveJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

[settingsFile, verifiedUsersFile, blacklistFile].forEach(f => { if (!fs.existsSync(f)) saveJSON(f, f.endsWith('s.json') ? {} : []); });

const isGloballyVerified = (id) => getJSON(verifiedUsersFile).includes(id);
const isBlacklisted = (id) => getJSON(blacklistFile).includes(id);

// --- EXPRESS SETUP ---
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'mystic_portal_secret', resave: false, saveUninitialized: false }));

app.get('/', (req, res) => res.send(`${CSS}<div class="card"><h1>🛡️ Portal Entrance</h1><a href="/auth/discord" class="btn">Authenticate Admin</a></div>`));

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
            return res.redirect('/admin-users');
        }
        res.send("Access Denied.");
    } catch (e) { res.send(`Auth Error: ${e.message}`); }
});

// --- ADMIN PAGES ---
app.get('/admin-users', (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    const vList = getJSON(verifiedUsersFile);
    const rows = vList.map(id => `<tr><td><code>${id}</code></td><td><form action="/unverify" method="POST"><input type="hidden" name="userId" value="${id}"><button class="btn" style="background:var(--danger); padding:5px 10px;">Revoke</button></form></td></tr>`).join('');
    res.send(`${CSS}<div class="container"><div class="card"><h2>Manual Registry</h2><form action="/manual-verify" method="POST" style="display:flex; gap:10px;"><input type="text" name="targetId" placeholder="User ID" required><button class="btn" style="width:auto;">Verify</button></form></div><div class="card"><table><tbody>${rows || '<tr><td>None</td></tr>'}</tbody></table></div></div>`);
});

app.post('/manual-verify', (req, res) => {
    if (!req.session.authenticated) return res.redirect('/');
    let v = getJSON(verifiedUsersFile);
    if (!v.includes(req.body.targetId)) { v.push(req.body.targetId); saveJSON(verifiedUsersFile, v); }
    res.redirect('/admin-users');
});

// --- USER FACING PORTAL (WITH LOADING Ritual) ---
app.get('/verify/:token', (req, res) => {
    const d = pendingVerifications.get(req.params.token);
    if (!d || isBlacklisted(d.userId)) return res.send("Link invalid or expired.");
    res.send(`${CSS}
    <div id="ritual-overlay">
        <div class="spinner"></div>
        <div class="ritual-text">COMMUNING WITH BESAFE ARCHIVES...</div>
        <p style="color:var(--parchment-text); opacity:0.6; margin-top:10px;">Encoding credentials for transmission</p>
    </div>
    <div class="container" style="margin-top:50px;">
        <div class="card">
            <h2>Identity Ritual</h2>
            <form id="verifyForm" action="/upload" method="POST" enctype="multipart/form-data">
                <input type="hidden" name="token" value="${req.params.token}">
                
                <label>Date of Birth</label>
                <input type="date" name="dob" required>
                
                <label>ID Photo</label>
                <input type="file" name="idPhoto" accept="image/*" required style="margin-bottom:15px;">
                
                <label>Face Photo (Selfie)</label>
                <input type="file" name="facePhoto" accept="image/*" required style="margin-bottom:20px;">
                
                <button type="submit" class="btn">Submit to BeSafe</button>
            </form>
        </div>
    </div>
    <script>
        document.getElementById('verifyForm').onsubmit = function() {
            document.getElementById('ritual-overlay').style.display = 'flex';
        };
    </script>`);
});

app.post('/upload', upload.fields([{ name: 'idPhoto', maxCount: 1 }, { name: 'facePhoto', maxCount: 1 }]), async (req, res) => {
    const d = pendingVerifications.get(req.body.token);
    if (!d) return res.send("Session Expired.");

    try {
        const idBase64 = `data:${req.files['idPhoto'][0].mimetype};base64,${fs.readFileSync(req.files['idPhoto'][0].path).toString('base64')}`;
        const faceBase64 = `data:${req.files['facePhoto'][0].mimetype};base64,${fs.readFileSync(req.files['facePhoto'][0].path).toString('base64')}`;

        await axios.post('https://besafesondiscord.com/api/v1/private/verify', {
            userId: d.userId,
            idPhoto: idBase64,
            facePhoto: faceBase64,
            dob: req.body.dob
        }, {
            headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.BESAFE_API_KEY }
        });

        fs.unlinkSync(req.files['idPhoto'][0].path);
        fs.unlinkSync(req.files['facePhoto'][0].path);
        pendingVerifications.delete(req.body.token);
        res.send(`${CSS}<div class="card"><h2>Transmission Successful</h2><p>Your details are being reviewed by BeSafe. Use <code>/verify</code> in Discord again shortly.</p></div>`);
    } catch (e) {
        res.send(`${CSS}<div class="card"><h2>Mystic Interference</h2><p>Error: ${e.message}</p><a href="javascript:history.back()" class="btn">Try Again</a></div>`);
    }
});

// --- DISCORD LOGIC ---
client.on('ready', async () => {
    const cmds = [
        new SlashCommandBuilder().setName('verify').setDescription('Start your verification.'),
        new SlashCommandBuilder().setName('setrole').setDescription('Configure the verified role.')
            .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    ];
    await new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN).put(Routes.applicationCommands(process.env.CLIENT_ID), { body: cmds });
});

client.on('interactionCreate', async (i) => {
    if (!i.isChatInputCommand()) return;
    const userId = i.user.id;
    if (i.commandName === 'setrole') {
        let s = getJSON(settingsFile, {}); s[i.guildId] = { roleId: i.options.getRole('role').id }; saveJSON(settingsFile, s);
        return i.reply({ content: '✅ Role configured.', ephemeral: true });
    }
    if (i.commandName === 'verify') {
        if (isBlacklisted(userId)) return i.reply({ content: '❌ Exiled.', ephemeral: true });
        
        try {
            const apiResp = await axios.get(`https://besafesondiscord.com/api/v1/public/user/${userId}`).catch(() => null);
            if (apiResp && apiResp.data.age?.isVerified && apiResp.data.age?.isAdult) {
                if (!isGloballyVerified(userId)) {
                    let v = getJSON(verifiedUsersFile); v.push(userId); saveJSON(verifiedUsersFile, v);
                }
            }
        } catch (e) {}

        if (isGloballyVerified(userId)) {
            const s = getJSON(settingsFile)[i.guildId] || {};
            if (s.roleId) await i.member.roles.add(s.roleId).catch(() => null);
            return i.reply({ content: '✅ Passage granted.', ephemeral: true });
        }

        const t = uuidv4();
        pendingVerifications.set(t, { userId, guildId: i.guildId });
        await i.user.send(`🛡️ **BeSafe Verification**: ${process.env.BASE_URL}/verify/${t}`).catch(() => null);
        i.reply({ content: 'Check your DMs.', ephemeral: true });
    }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.listen(process.env.PORT || 3000, () => console.log("BeSafe Ritual Gateway Online."));
client.login(process.env.DISCORD_TOKEN);