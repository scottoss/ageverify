require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Fixed UUID import for CommonJS
const { v4: uuidv4 } = require('uuid');

// --- INITIALIZATION ---
const app = express();
const upload = multer({ dest: 'uploads/' });
const pendingVerifications = new Map();
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

// --- CSS STYLING ---
const CSS = `
<style>
    :root { --discord-blurple: #5865F2; --dark-bg: #23272A; --card-bg: #2C2F33; --text: #ffffff; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: var(--dark-bg); color: var(--text); display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .card { background: var(--card-bg); padding: 40px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); width: 100%; max-width: 400px; text-align: center; }
    .logo { width: 80px; height: 80px; margin-bottom: 20px; border-radius: 50%; border: 3px solid var(--discord-blurple); }
    h2 { margin-bottom: 10px; color: var(--discord-blurple); }
    p { color: #B9BBBE; font-size: 14px; line-height: 1.5; }
    input[type="file"] { margin: 20px 0; color: #B9BBBE; width: 100%; }
    button { background: var(--discord-blurple); color: white; border: none; padding: 12px 24px; border-radius: 5px; font-weight: bold; cursor: pointer; transition: 0.2s; width: 100%; font-size: 16px; }
    button:hover { background: #4752C4; transform: translateY(-1px); }
    .footer-note { font-size: 11px; margin-top: 20px; color: #72767D; border-top: 1px solid #40444B; padding-top: 15px; }
    .id-preview { width: 100%; border-radius: 8px; border: 2px solid #40444B; margin: 15px 0; }
    .btn-deny { background: #ED4245; margin-top: 10px; }
    .btn-deny:hover { background: #C03537; }
</style>
`;

// --- MIDDLEWARE ---
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Set to true if using HTTPS
}));

const isAdmin = (req, res, next) => {
    if (req.session.authenticated) return next();
    res.redirect('/login');
};

// --- DISCORD BOT LOGIC ---
client.on('ready', async () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const commands = [
        new SlashCommandBuilder().setName('verify').setDescription('Starts age verification process.')
    ].map(c => c.toJSON());
    
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'verify') {
        const token = uuidv4();
        pendingVerifications.set(token, { 
            userId: interaction.user.id, 
            status: 'awaiting_upload', 
            timestamp: Date.now() 
        });
        await interaction.reply({ 
            content: `Please upload your ID here: ${process.env.BASE_URL}/verify/${token}`, 
            ephemeral: true 
        });
    }
});

// --- WEB ROUTES ---

// Login Page
app.get('/login', (req, res) => {
    res.send(`${CSS}<div class="card"><h2>Staff Portal</h2><form method="POST"><input type="password" name="pw" placeholder="Admin Password" style="width:100%; padding:10px; margin-bottom:15px; border-radius:5px; border:none;"><button>Login</button></form></div>`);
});

app.post('/login', (req, res) => {
    if (req.body.pw === process.env.ADMIN_PASSWORD) {
        req.session.authenticated = true;
        return res.redirect('/admin-review');
    }
    res.send('Wrong password. <a href="/login">Try again</a>');
});

// User Upload Page
app.get('/verify/:token', (req, res) => {
    if (!pendingVerifications.has(req.params.token)) return res.status(404).send('Invalid or expired link.');
    res.send(`
        ${CSS}
        <div class="card">
            <img src="https://cdn-icons-png.flaticon.com/512/1077/1077114.png" class="logo">
            <h2>Identity Verification</h2>
            <p>Upload a clear photo of your ID. Ensure your <strong>Date of Birth</strong> is visible. Our staff will review it shortly.</p>
            <form action="/upload" method="POST" enctype="multipart/form-data">
                <input type="hidden" name="token" value="${req.params.token}">
                <input type="file" name="idImage" accept="image/*" required>
                <button type="submit">Submit for Review</button>
            </form>
            <div class="footer-note">🛡️ Photos are deleted permanently after review.</div>
        </div>
    `);
});

app.post('/upload', upload.single('idImage'), async (req, res) => {
    const data = pendingVerifications.get(req.body.token);
    if (!data || !req.file) return res.status(400).send('Upload failed.');

    data.filename = req.file.filename;
    data.status = 'pending_review';

    try {
        const channel = await client.channels.fetch(process.env.ADMIN_CHANNEL_ID);
        channel.send({ embeds: [new EmbedBuilder().setTitle('🔔 New ID Uploaded').setDescription(`User <@${data.userId}> has submitted an ID for review.`).setColor('Orange')] });
    } catch (e) { console.error("Could not send admin notification."); }
    
    res.send(`${CSS}<div class="card"><h2>Success!</h2><p>Your ID has been submitted. You will receive a DM from the bot once it has been reviewed.</p></div>`);
});

// Admin Dashboard
app.use('/view-id', isAdmin, express.static(uploadDir));

app.get('/admin-review', isAdmin, (req, res) => {
    let reviews = '';
    pendingVerifications.forEach((val, key) => {
        if (val.status === 'pending_review') {
            reviews += `
                <div class="card" style="margin-bottom:20px; max-width: 500px;">
                    <p><strong>Discord User ID:</strong> ${val.userId}</p>
                    <img src="/view-id/${val.filename}" class="id-preview">
                    <form action="/decide" method="POST">
                        <input type="hidden" name="token" value="${key}">
                        <button name="choice" value="approve">APPROVE & DELETE</button>
                        <button name="choice" value="deny" class="btn-deny">DENY & DELETE</button>
                    </form>
                </div>`;
        }
    });

    res.send(`${CSS}<div style="padding: 40px; width: 100%;"><h1 style="text-align:center;">Pending Reviews</h1><div style="display:flex; flex-direction:column; align-items:center;">${reviews || '<p>No IDs currently waiting.</p>'}</div></div>`);
});

app.post('/decide', isAdmin, async (req, res) => {
    const { token, choice } = req.body;
    const data = pendingVerifications.get(token);
    if (!data) return res.redirect('/admin-review');

    try {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const member = await guild.members.fetch(data.userId);
        if (choice === 'approve') {
            await member.roles.add(process.env.VERIFIED_ROLE_ID);
            await member.send("✅ Your age verification has been approved! You now have access.");
        } else {
            await member.send("❌ Your age verification was denied. Please try again with a clearer photo.");
        }
    } catch (e) { console.log("User may have left the server."); }

    if (fs.existsSync(path.join(uploadDir, data.filename))) fs.unlinkSync(path.join(uploadDir, data.filename));
    pendingVerifications.delete(token);
    res.redirect('/admin-review');
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// --- AUTO-CLEANUP (Every Hour) ---
setInterval(() => {
    const now = Date.now();
    pendingVerifications.forEach((data, token) => {
        if (now - data.timestamp > 24 * 60 * 60 * 1000) { 
            if (data.filename && fs.existsSync(path.join(uploadDir, data.filename))) {
                fs.unlinkSync(path.join(uploadDir, data.filename));
            }
            pendingVerifications.delete(token);
        }
    });
}, 3600000);

app.listen(process.env.PORT || 3000, () => console.log(`🌍 Server live at ${process.env.BASE_URL}`));
client.login(process.env.DISCORD_TOKEN);