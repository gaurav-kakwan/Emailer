const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const app = express();

const port = process.env.PORT || 3000;
const MAX_USERS = 1;
const SESSION_TIMEOUT = 24 * 60 * 60 * 1000; 
const MAX_EMAILS = 20000; 

app.use(express.json({ limit: '10mb' }));

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.use(express.static(__dirname));

let activeSessions = new Map();

function generateToken() {
    return Math.random().toString(36).substr(2, 12) + Date.now().toString(36);
}

function cleanupExpiredSessions() {
    const now = Date.now();
    let removed = 0;
    for (const [token, data] of activeSessions) {
        if (now - data.lastActivity > SESSION_TIMEOUT) {
            activeSessions.delete(token);
            removed++;
        }
    }
    if (removed > 0) console.log('[CLEANUP] ' + removed + ' session(s) expired.');
}

setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

function validateSession(token) {
    if (!token || !activeSessions.has(token)) return false;
    const data = activeSessions.get(token);
    if (Date.now() - data.lastActivity > SESSION_TIMEOUT) {
        activeSessions.delete(token);
        return false;
    }
    data.lastActivity = Date.now();
    return true;
}

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === "admin" && password === "kakwan") {
        cleanupExpiredSessions();
        if (activeSessions.size >= MAX_USERS) {
            return res.json({ success: false, msg: "User Limit Reached!" });
        }
        const token = generateToken();
        activeSessions.set(token, { loginTime: Date.now(), lastActivity: Date.now() });
        console.log('[LOGIN] Session started (24h)');
        return res.json({ success: true, token: token });
    }
    return res.json({ success: false, msg: "Invalid Credentials" });
});

app.post('/logout', (req, res) => {
    const { token } = req.body;
    if (token && activeSessions.has(token)) activeSessions.delete(token);
    res.json({ success: true });
});

app.post('/check-session', (req, res) => {
    const { token } = req.body;
    if (validateSession(token)) res.json({ valid: true });
    else res.json({ valid: false });
});

function replaceTags(str, greet, website, signature, email) {
    return str
        .replace(/\{greet\}/gi, greet || '')
        .replace(/\{website\}/gi, website || '')
        .replace(/\{signature\}/gi, signature || '')
        .replace(/\{email\}/gi, email || '');
}

function parseRecipients(raw) {
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l);
    const list = [];
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

    for (const line of lines) {
        if(line.includes('\t')) {
            let parts = line.split('\t').map(p=>p.trim());
            if(parts.length >= 3 && emailRegex.test(parts[2])) {
                list.push({ greet: parts[0], website: parts[1], email: parts[2] });
                continue;
            }
        }
        if(line.includes(',')) {
            let parts = line.split(',').map(p=>p.trim());
            let emailPart = parts.find(p => emailRegex.test(p));
            if(emailPart){
                let idx = parts.indexOf(emailPart);
                let greet = idx > 0 ? parts.slice(0, idx).join(' ') : '';
                let website = idx > 1 ? parts[idx-1] : '';
                list.push({ greet, website, email: emailPart });
                continue;
            }
        }
        if(emailRegex.test(line)){
             list.push({ greet: '', website: '', email: line });
        }
    }
    return list;
}

app.post('/send', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { senderAccountsString, subject, limitPerAccount, replyTo, message, to } = req.body;

        if (!senderAccountsString || !to) {
            return res.json({ success: false, msg: "Missing Accounts or Recipients." });
        }

        const lines = senderAccountsString.split('\n');
        const senders = [];
        
        lines.forEach(line => {
            if(!line.trim()) return;
            const parts = line.split(/\t|,|:/).map(p => p.trim()).filter(p => p);
            if (parts.length >= 2) {
                let email = parts[0];
                let pass = parts[1];
                let name = parts[2] || email.split('@')[0]; 
                if (email.includes('@')) senders.push({ email, pass, name });
            }
        });

        if (senders.length === 0) {
            return res.json({ success: false, msg: "No valid sender accounts found." });
        }

        const transporters = senders.map(s => {
            return nodemailer.createTransport({
                service: 'gmail',
                auth: { user: s.email, pass: s.pass },
                connectionTimeout: 5000, 
                socketTimeout: 5000
            });
        });

        console.log('[INFO] Loaded ' + senders.length + ' accounts.');

        const recipients = parseRecipients(to);
        if (recipients.length === 0) {
            return res.json({ success: false, msg: "No valid recipients found." });
        }
        if (recipients.length > MAX_EMAILS) {
            return res.json({ success: false, msg: "Limit: Max " + MAX_EMAILS + " emails." });
        }

        const totalRecipients = recipients.length;
        const totalAccounts = senders.length;
        const limit = parseInt(limitPerAccount) || 50; 
        const BATCH_SIZE = 1; // 5-5 ke batch

        const senderUsage = new Array(totalAccounts).fill(0);
        
        let sentCount = 0;
        let failCount = 0;

        res.setHeader('Content-Type', 'application/json');

        console.log(`[START] Total: ${totalRecipients} | Accounts: ${totalAccounts} | Batch: ${BATCH_SIZE}`);

        for (let i = 0; i < totalRecipients; i += BATCH_SIZE) {
            const batch = recipients.slice(i, i + BATCH_SIZE);
            
            const promises = batch.map((recipient, index) => {
                let senderIndex = (i + index) % totalAccounts;
                
                const currentSender = senders[senderIndex];
                const currentTransporter = transporters[senderIndex];

                return new Promise(async (resolve) => {
                    if (senderUsage[senderIndex] >= limit) {
                        resolve(false);
                        return;
                    }

                    try {
                        const personalSubject = replaceTags(subject, recipient.greet, recipient.website, currentSender.name, currentSender.email);
                        const personalMessage = replaceTags(message, recipient.greet, recipient.website, currentSender.name, currentSender.email);

                        const mailOptions = {
                            from: `"${currentSender.name}" <${currentSender.email}>`,
                            to: recipient.email,
                            subject: personalSubject,
                            text: personalMessage
                        };

                        if (replyTo) mailOptions.replyTo = replyTo;

                        await currentTransporter.sendMail(mailOptions);
                        
                        sentCount++;
                        senderUsage[senderIndex]++;

                        res.write(JSON.stringify({ type: 'progress', sent: sentCount, total: totalRecipients, currentEmail: currentSender.email }) + '\n');
                        
                        resolve(true);
                    } catch (err) {
                        failCount++;
                        console.log(`\n    ✗ Error [${currentSender.email}]: ${err.message}`);
                        resolve(false);
                    }
                });
            });

            await Promise.all(promises);
        }

        const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\n[DONE] Sent: ${sentCount} | Fail: ${failCount} | Time: ${timeTaken}s`);
        
        res.write(JSON.stringify({ type: 'done', sent: sentCount, fail: failCount, timeTaken: timeTaken }) + '\n');
        res.end();

    } catch (err) {
        console.error("[CRITICAL ERROR]:", err);
        try {
            res.write(JSON.stringify({ success: false, msg: "Server Error: " + err.message }) + '\n');
            res.end();
        } catch(e) {}
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log('Server running on port ' + port);
});
