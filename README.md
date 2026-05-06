# 🛡️ Discord Age Verification System By Fnaf_Rainbow And CreatorPlaza and BeSafe
A secure, privacy-first age verification solution combining a Discord Bot and a Web Portal. This system allows server administrators to verify user ages via manual ID review without permanently storing sensitive government documents.

# ✨ Features
Slash Command Integration: Users initiate verification easily with /verify.


Privacy-First Architecture: * IDs are immediately deleted from the server once a decision is made.

Uses unique, non-guessable tokens for every verification session.


# 🏗️ Technical Stack
Runtime: Node.js (v18+)

Bot Framework: discord.js

Web Framework: Express.js

File Handling: Multer

Security: Express-session & Dotenv

# 🚀 Getting Started
1. Prerequisites
A Discord Bot Token (Discord Developer Portal)

Node.js installed on your machine.

"Developer Mode" enabled in Discord to copy IDs.

2. Installation

# Clone the repository 
```bash
git clone https://github.com/scottoss/ageverify
```

# Enter the directory
```bash
cd ageverify
```

# Install dependencies
```bash
npm install
```
Note: This project uses uuid@9.0.1 specifically to maintain CommonJS compatibility.

3. Configuration
Create a .env file in the root directory and fill in the following:

```bash
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id
GUILD_ID=your_server_id
VERIFIED_ROLE_ID=id_of_the_role_to_grant
ADMIN_CHANNEL_ID=channel_id_for_staff_alerts

PORT=3000
BASE_URL=http://localhost:3000
ADMIN_PASSWORD=your_dashboard_password
SESSION_SECRET=a_long_random_string_for_security
```
4. Running the Application
```bash
# Start with Node
node index.js
```

# Recommended: Start with PM2 for 24/7 uptime
```bash
npm install pm2 -g
pm2 start index.js --name "age-bot"
```

# 🔒 Security & Liability
SSL/HTTPS Requirement
Warning: Handling government IDs over unencrypted http is a massive security risk. In a production environment, you must use an SSL certificate (e.g., Let's Encrypt) and run this behind a reverse proxy like Nginx.

Permissions
The bot's role in your Discord server must be positioned higher than the "Verified" role in the hierarchy, otherwise, it will be unable to assign the role to users.

Data Handling
This bot is designed to be a "pass-through" system. We recommend updating your server's Privacy Policy to reflect that IDs are reviewed by humans and deleted immediately after the check is complete.

# 🤝 Contributing
Contributions are welcome! Please feel free to submit a Pull Request.

# 📄 License
This project is licensed under the MIT License.